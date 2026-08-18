"use client";

import { create } from "zustand";
import { persist, createJSONStorage, StateStorage } from "zustand/middleware";
import { Chat, Message, Project, Artifact, Attachment } from "./types";
import { hermesStream, StoppedError } from "./hermes-api";
import { extractArtifacts } from "./extract";
import { uid } from "./uid";
import { api } from "./api";
import {
  buildAgentContext,
  uploadAttachments,
  attachmentMeta,
  turnErrorMessage,
  abortControllers,
  extractChatTitle,
  stripTitleForDisplay,
} from "./send-turn";

/**
 * Phase 3: state lives on the server (per Slack user) via /api/state.
 * Writes are debounced; a legacy localStorage blob seeds the first load.
 */
let putTimer: ReturnType<typeof setTimeout> | undefined;
let pendingBlob = "";

const serverStorage: StateStorage = {
  getItem: async (name) => {
    const res = await api.get<{ blob?: string | null }>("/api/state");
    if (res.ok && res.data.blob) return res.data.blob;
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
    putTimer = setTimeout(async () => {
      const res = await api.put("/api/state", { blob: pendingBlob });
      if (!res.ok) console.warn(`[state] save failed: ${res.error}`);
    }, 800);
  },
  removeItem: async () => {
    await api.del("/api/state");
  },
};

/**
 * Per-chat message persistence, debounced per chat id. Only the chat that
 * changed is written — the old design re-serialised every chat and every
 * message on every keystroke batch.
 */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function persistChat(chat: Chat, delay = 600): void {
  if (!chat.loaded) return; // never overwrite server history with an unloaded stub
  clearTimeout(saveTimers.get(chat.id));
  saveTimers.set(
    chat.id,
    setTimeout(async () => {
      saveTimers.delete(chat.id);
      const res = await api.put(`/api/chats/${encodeURIComponent(chat.id)}`, {
        messages: chat.messages,
        title: chat.title,
        pinned: chat.pinned,
      });
      if (!res.ok) console.warn(`[chats] save failed for ${chat.id}: ${res.error}`);
    }, delay)
  );
}

interface HermesState {
  chats: Chat[];
  projects: Project[];
  artifacts: Artifact[];
  isStreaming: boolean;
  _hasHydrated: boolean;
  _chatsLoaded: boolean;

  createChat: (firstMessage: string, projectId?: string, attachments?: Attachment[]) => string;
  sendMessage: (chatId: string, content: string, attachments?: Attachment[]) => void;
  togglePin: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  renameChat: (chatId: string, title: string) => void;

  /** Load chat metadata (no messages) — runs migration server-side on first call. */
  loadChats: () => Promise<void>;
  /** Fetch one chat's messages on demand; no-op if already loaded. */
  ensureChatLoaded: (chatId: string) => Promise<void>;

  /** Projects are SHARED across all members via /api/projects. */
  loadProjects: () => Promise<void>;
  createProject: (
    name: string,
    description: string,
    folders?: {
      workingFolder?: string;
      driveFolder?: string;
      slackChannel?: string;
      startDate?: string;
      deadline?: string;
    }
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
      _chatsLoaded: false,

      loadChats: async () => {
        const res = await api.get<{ chats: Chat[]; migration?: { chats: number } }>("/api/chats");
        if (!res.ok) {
          console.warn(`[chats] list failed: ${res.error}`);
          return;
        }
        if (res.data.migration) {
          console.log(`[chats] migrated ${res.data.migration.chats} chats to per-chat storage`);
        }
        // Metadata only: messages arrive when a chat is opened.
        set((s) => {
          const localLoaded = new Map(
            s.chats.filter((c) => c.loaded).map((c) => [c.id, c] as const)
          );
          return {
            _chatsLoaded: true,
            chats: res.data.chats.map((meta) => {
              const local = localLoaded.get(meta.id);
              return local
                ? { ...meta, messages: local.messages, loaded: true }
                : { ...meta, messages: [] };
            }),
          };
        });
      },

      ensureChatLoaded: async (chatId) => {
        const existing = get().chats.find((c) => c.id === chatId);
        if (existing?.loaded) return;
        const res = await api.get<{ chat: Chat }>(`/api/chats/${encodeURIComponent(chatId)}`);
        if (!res.ok) {
          console.warn(`[chats] load failed for ${chatId}: ${res.error}`);
          return;
        }
        set((s) => ({
          chats: s.chats.some((c) => c.id === chatId)
            ? s.chats.map((c) => (c.id === chatId ? { ...res.data.chat, loaded: true } : c))
            : [{ ...res.data.chat, loaded: true }, ...s.chats],
        }));
      },

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
          loaded: true, // brand new: nothing on the server to lose
        };
        set((s) => ({ chats: [chat, ...s.chats] }));
        // Create server-side first so the later message PUT has a target.
        api.post("/api/chats", { ...chat, messages: [] }).then((res) => {
          if (!res.ok) console.warn(`[chats] create failed: ${res.error}`);
        });
        get().sendMessage(id, firstMessage, attachments);
        return id;
      },

      sendMessage: (chatId, content, attachments) => {
        const now = new Date().toISOString();
        const userId = uid("m");
        // Store only lightweight metadata in state — never the base64 bytes.
        const metaAttachments = attachmentMeta(attachments);
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
        /** Write this chat's messages to its own file (debounced). */
        const saveThisChat = () => {
          const c = get().chats.find((x) => x.id === chatId);
          if (c) persistChat(c);
        };
        const patchAsst = (patch: Partial<Message>) => patchMsg(asstId, patch);

        // Upload attachment bytes to the server (off the state blob), then
        // patch the user message with lightweight {…,id} references.
        if (attachments?.length) {
          uploadAttachments(attachments).then((refs) => patchMsg(userId, { attachments: refs }));
        }

        // Shared context builder — identical wording on every send path.
        const project = chat?.projectId
          ? get().projects.find((p) => p.id === chat.projectId)
          : undefined;
        const context = buildAgentContext(project, undefined, priorHistory.length === 0);

        // Register an abort handle so the UI can stop this turn.
        const controller = new AbortController();
        abortControllers.set(chatId, controller);

        hermesStream(
          content,
          priorHistory,
          attachments ?? [],
          chatId,
          (state) =>
            patchAsst({
              content: stripTitleForDisplay(state.content),
              thinking: state.thinking,
              status: state.status,
              idleMs: state.idleMs,
              state: "working",
            }),
          context,
          project?.id,
          controller.signal
        )
          .catch((err: unknown) => {
            // Mark the turn failed so the UI can offer Retry — including the
            // attachments (read back from the stored user message, so they
            // carry their server ids and can be resent).
            const storedUser = get()
              .chats.find((c) => c.id === chatId)
              ?.messages.find((m) => m.id === userId);
            const stopped = err instanceof StoppedError;
            patchAsst({
              state: stopped ? "done" : "failed",
              status: undefined,
              idleMs: undefined,
              retryOf: stopped ? undefined : content,
              retryAttachments: stopped ? undefined : storedUser?.attachments,
              content: stopped ? "⏹ Stopped." : turnErrorMessage(err),
            });
            set({ isStreaming: false });
            saveThisChat();
            return null;
          })
          .then((final) => {
            if (!final) return;
            // First turn: the agent names the chat via a trailing tag (see
            // send-turn.ts) — strip it from the reply, use it as the title.
            const { content: cleanContent, title } = extractChatTitle(final.content);
            // Promote substantial code blocks in the reply to artifacts.
            const newArtifacts = extractArtifacts(
              cleanContent,
              chatId,
              title ?? chat?.title ?? "Conversation",
              () => uid("art")
            );
            const doneAt = new Date().toISOString();
            patchAsst({
              content: cleanContent,
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
            if (title) get().renameChat(chatId, title);
            saveThisChat();
          })
          .finally(() => abortControllers.delete(chatId));
      },

      togglePin: (chatId) => {
        const next = !get().chats.find((c) => c.id === chatId)?.pinned;
        set((s) => ({
          chats: s.chats.map((c) => (c.id === chatId ? { ...c, pinned: next } : c)),
        }));
        // Metadata-only PATCH — does not rewrite the message file.
        api.patch(`/api/chats/${encodeURIComponent(chatId)}`, { pinned: next });
      },

      deleteChat: (chatId) => {
        clearTimeout(saveTimers.get(chatId)); // don't resurrect it with a pending save
        saveTimers.delete(chatId);
        set((s) => ({ chats: s.chats.filter((c) => c.id !== chatId) }));
        api.del(`/api/chats/${encodeURIComponent(chatId)}`);
      },

      renameChat: (chatId, title) => {
        set((s) => ({
          chats: s.chats.map((c) => (c.id === chatId ? { ...c, title } : c)),
        }));
        api.patch(`/api/chats/${encodeURIComponent(chatId)}`, { title });
      },

      loadProjects: async () => {
        const res = await api.get<{ projects?: Project[] }>("/api/projects");
        if (!res.ok) {
          console.warn(`[projects] load failed: ${res.error}`);
          return;
        }
        set({ projects: res.data.projects ?? [] });
      },

      createProject: async (name, description, folders) => {
        const res = await api.post<{ project: Project }>("/api/projects", {
          name,
          description,
          ...folders,
        });
        if (!res.ok) {
          console.warn(`[projects] create failed: ${res.error}`);
          return undefined;
        }
        set((s) => ({ projects: [...s.projects, res.data.project] }));
        return res.data.project;
      },

      updateProject: async (id, patch) => {
        // optimistic
        set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
        const res = await api.patch(`/api/projects/${encodeURIComponent(id)}`, patch);
        if (!res.ok) console.warn(`[projects] update failed: ${res.error}`);
      },

      deleteProject: async (id) => {
        const doomed = get().chats.filter((c) => c.projectId === id);
        set((s) => {
          const chatIds = new Set(doomed.map((c) => c.id));
          return {
            projects: s.projects.filter((p) => p.id !== id),
            chats: s.chats.filter((c) => c.projectId !== id),
            artifacts: s.artifacts.filter((a) => !(a.chatId && chatIds.has(a.chatId))),
          };
        });
        // Remove the chat files too, or they'd linger as orphans on disk.
        await Promise.all(doomed.map((c) => api.del(`/api/chats/${encodeURIComponent(c.id)}`)));
        const res = await api.del(`/api/projects/${encodeURIComponent(id)}`);
        if (!res.ok) console.warn(`[projects] delete failed: ${res.error}`);
      },
    }),
    {
      name: "hermes-ui-state",
      storage: createJSONStorage(() => serverStorage),
      // Rehydrate manually after mount to avoid SSR hydration mismatches.
      skipHydration: true,
      // Only artifacts live in this blob now. Chats moved to one file each
      // (/api/chats) — keeping them here is what grew the blob to 8 MB and
      // made every keystroke re-serialise the entire history.
      // Projects are NOT persisted here either — they live in the shared store.
      partialize: (s) => ({
        artifacts: s.artifacts,
      }),
      onRehydrateStorage: () => () => {
        useHermesStore.setState({ _hasHydrated: true });
        // Chats live server-side now; fetch their metadata once state is ready.
        useHermesStore.getState().loadChats();
      },
    }
  )
);
