"use client";

import { create } from "zustand";
import { persist, createJSONStorage, StateStorage } from "zustand/middleware";
import { Chat, Message, Project, Artifact, Attachment } from "./types";
import { hermesStream } from "./hermes-api";
import { extractArtifacts } from "./extract";

let counter = 0;
const uid = (p: string) => `${p}-${Date.now()}-${counter++}`;

/**
 * Phase 3: state lives on the server (per Slack user) via /api/state.
 * Writes are debounced; a legacy localStorage blob seeds the first load.
 */
let putTimer: ReturnType<typeof setTimeout> | undefined;
let pendingBlob = "";

const serverStorage: StateStorage = {
  getItem: async (name) => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { blob?: string | null };
        if (data.blob) return data.blob;
      }
    } catch {}
    // First run: migrate any legacy localStorage state to the server.
    try {
      const legacy = localStorage.getItem(name);
      if (legacy) serverStorage.setItem(name, legacy);
      return legacy;
    } catch {
      return null;
    }
  },
  setItem: (_name, value) => {
    pendingBlob = value;
    clearTimeout(putTimer);
    putTimer = setTimeout(() => {
      fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blob: pendingBlob }),
      }).catch(() => {});
    }, 800);
  },
  removeItem: async () => {
    await fetch("/api/state", { method: "DELETE" }).catch(() => {});
  },
};

interface HermesState {
  chats: Chat[];
  projects: Project[];
  artifacts: Artifact[];
  isStreaming: boolean;
  _hasHydrated: boolean;

  createChat: (firstMessage: string, projectId?: string, attachments?: Attachment[]) => string;
  sendMessage: (chatId: string, content: string, attachments?: Attachment[]) => void;
  togglePin: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  renameChat: (chatId: string, title: string) => void;

  /** Projects are SHARED across all members via /api/projects. */
  loadProjects: () => Promise<void>;
  createProject: (
    name: string,
    description: string,
    folders?: { workingFolder?: string; driveFolder?: string; slackChannel?: string }
  ) => Promise<Project | undefined>;
  updateProject: (id: string, patch: Partial<Project>) => Promise<void>;
  /** Removes the shared project; also drops the local user's chats/artifacts in it. */
  deleteProject: (id: string) => Promise<void>;
}

export const useHermesStore = create<HermesState>()(
  persist(
    (set, get) => ({
      chats: [],
      projects: [],
      artifacts: [],
      isStreaming: false,
      _hasHydrated: false,

      createChat: (firstMessage, projectId, attachments) => {
        const now = new Date().toISOString();
        const id = uid("chat");
        const chat: Chat = {
          id,
          title: firstMessage.slice(0, 48) + (firstMessage.length > 48 ? "…" : ""),
          pinned: false,
          projectId,
          createdAt: now,
          updatedAt: now,
          messages: [],
        };
        set((s) => ({ chats: [chat, ...s.chats] }));
        get().sendMessage(id, firstMessage, attachments);
        return id;
      },

      sendMessage: (chatId, content, attachments) => {
        const now = new Date().toISOString();
        const userId = uid("m");
        // Store only lightweight metadata in state — never the base64 bytes.
        const metaAttachments: Attachment[] | undefined = attachments?.length
          ? attachments.map((a) => ({ name: a.name, type: a.type, size: a.size }))
          : undefined;
        const userMsg: Message = {
          id: userId,
          role: "user",
          content,
          createdAt: now,
          attachments: metaAttachments,
        };
        const chat = get().chats.find((c) => c.id === chatId);
        const priorHistory = chat?.messages ?? [];
        const asstId = uid("m");
        const asstMsg: Message = {
          id: asstId,
          role: "assistant",
          content: "",
          thinking: "",
          createdAt: now,
        };
        set((s) => ({
          isStreaming: true,
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, userMsg, asstMsg], updatedAt: now }
              : c
          ),
        }));

        const patchMsg = (msgId: string, patch: Partial<Message>) =>
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
                  }
                : c
            ),
          }));
        const patchAsst = (patch: Partial<Message>) => patchMsg(asstId, patch);

        // Upload attachment bytes to the server (off the state blob), then
        // patch the user message with lightweight {…,id} references.
        if (attachments?.length) {
          (async () => {
            const refs: Attachment[] = [];
            for (const a of attachments) {
              const base: Attachment = { name: a.name, type: a.type, size: a.size };
              try {
                const res = await fetch("/api/attachments", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: a.name, type: a.type, dataUrl: a.dataUrl }),
                });
                if (res.ok) base.id = (await res.json()).id;
              } catch {}
              refs.push(base);
            }
            patchMsg(userId, { attachments: refs });
          })();
        }

        // Project working-folder context travels with every message.
        const project = chat?.projectId
          ? get().projects.find((p) => p.id === chat.projectId)
          : undefined;
        // Working folder for the agent:
        // - If the project path maps onto the server's rclone Drive mount
        //   (NEXT_PUBLIC_DRIVE_BASE → NEXT_PUBLIC_DRIVE_MOUNT_BASE), use it —
        //   the agent then reads/writes the real shared Drive.
        // - Otherwise fall back to the server workspace; the browser courier
        //   delivers those files to the user's machine.
        const SAFETY_RULES =
          `File-safety rules: only CREATE new files; never delete or move files; if a ` +
          `change to an existing file is needed, save a new versioned copy ` +
          `(e.g. name-v2.ext) and tell the user — never overwrite the original.`;

        let context: string | undefined;
        if (project?.workingFolder) {
          context =
            `The user is working in project "${project.name}". Working folder: ` +
            `${project.workingFolder} — it is the team's shared Drive, mounted on this ` +
            `machine. Read project files from there and save all generated files there. ` +
            SAFETY_RULES;
        } else {
          // Private chat: no project folder. Keep deliverables in one predictable
          // place instead of the agent's data root, and always state the full
          // path — the UI turns it into a download button for the user.
          context =
            `This is a private chat with no project folder. Save any files you ` +
            `generate in /opt/data/outputs/ (create the folder if needed), not in ` +
            `/opt/data directly. When you finish a file, always tell the user its ` +
            `full absolute path — the interface turns that path into a download ` +
            `button. ` + SAFETY_RULES;
        }

        hermesStream(
          content,
          priorHistory,
          attachments ?? [],
          chatId,
          (state) =>
            patchAsst({
              content: state.content,
              thinking: state.thinking,
              status: state.status,
              idleMs: state.idleMs,
              state: "working",
            }),
          context,
          project?.id
        )
          .catch((err: unknown) => {
            // Mark the turn failed so the UI can offer Retry — including the
            // attachments (read back from the stored user message, so they
            // carry their server ids and can be resent).
            const storedUser = get()
              .chats.find((c) => c.id === chatId)
              ?.messages.find((m) => m.id === userId);
            patchAsst({
              state: "failed",
              status: undefined,
              retryOf: content,
              retryAttachments: storedUser?.attachments,
              content: `⚠️ ${err instanceof Error ? err.message : "The reply failed."}`,
            });
            set({ isStreaming: false });
            return null;
          })
          .then((final) => {
            if (!final) return;
            // Promote substantial code blocks in the reply to artifacts.
            const newArtifacts = extractArtifacts(
              final.content,
              chatId,
              chat?.title ?? "Conversation",
              () => uid("art")
            );
            const doneAt = new Date().toISOString();
            patchAsst({
              content: final.content,
              thinking: final.thinking,
              artifactId: newArtifacts[0]?.id,
              status: undefined,
              idleMs: undefined,
              state: "done",
            });
            set((s) => ({
              isStreaming: false,
              artifacts: [...s.artifacts, ...newArtifacts],
              chats: s.chats.map((c) => (c.id === chatId ? { ...c, updatedAt: doneAt } : c)),
            }));
          });
      },

      togglePin: (chatId) =>
        set((s) => ({
          chats: s.chats.map((c) => (c.id === chatId ? { ...c, pinned: !c.pinned } : c)),
        })),

      deleteChat: (chatId) =>
        set((s) => ({ chats: s.chats.filter((c) => c.id !== chatId) })),

      renameChat: (chatId, title) =>
        set((s) => ({
          chats: s.chats.map((c) => (c.id === chatId ? { ...c, title } : c)),
        })),

      loadProjects: async () => {
        try {
          const res = await fetch("/api/projects", { cache: "no-store" });
          if (!res.ok) return;
          const data = (await res.json()) as { projects?: Project[] };
          set({ projects: data.projects ?? [] });
        } catch {}
      },

      createProject: async (name, description, folders) => {
        try {
          const res = await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, ...folders }),
          });
          if (!res.ok) return undefined;
          const { project } = (await res.json()) as { project: Project };
          set((s) => ({ projects: [...s.projects, project] }));
          return project;
        } catch {
          return undefined;
        }
      },

      updateProject: async (id, patch) => {
        // optimistic
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
        try {
          await fetch(`/api/projects/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
        } catch {}
      },

      deleteProject: async (id) => {
        set((s) => {
          const chatIds = new Set(s.chats.filter((c) => c.projectId === id).map((c) => c.id));
          return {
            projects: s.projects.filter((p) => p.id !== id),
            chats: s.chats.filter((c) => c.projectId !== id),
            artifacts: s.artifacts.filter((a) => !(a.chatId && chatIds.has(a.chatId))),
          };
        });
        try {
          await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
        } catch {}
      },
    }),
    {
      name: "hermes-ui-state",
      storage: createJSONStorage(() => serverStorage),
      // Rehydrate manually after mount to avoid SSR hydration mismatches.
      skipHydration: true,
      // Projects are NOT persisted here — they live in the shared store.
      partialize: (s) => ({
        chats: s.chats,
        artifacts: s.artifacts,
      }),
      onRehydrateStorage: () => () => {
        useHermesStore.setState({ _hasHydrated: true });
      },
    }
  )
);
