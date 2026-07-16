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

  createProject: (name: string, description: string) => string;
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
        const userMsg: Message = {
          id: uid("m"),
          role: "user",
          content,
          createdAt: now,
          attachments: attachments?.length ? attachments : undefined,
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

        const patchAsst = (patch: Partial<Message>) =>
          set((s) => ({
            chats: s.chats.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) => (m.id === asstId ? { ...m, ...patch } : m)),
                  }
                : c
            ),
          }));

        hermesStream(content, priorHistory, attachments ?? [], chatId, (state) =>
          patchAsst({ content: state.content, thinking: state.thinking })
        ).then((final) => {
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

      createProject: (name, description) => {
        const id = uid("proj");
        const colors = ["#d97757", "#6a9b7e", "#7d8bc4", "#c4a35a", "#a3719b"];
        set((s) => ({
          projects: [
            ...s.projects,
            {
              id,
              name,
              description,
              color: colors[s.projects.length % colors.length],
              createdAt: new Date().toISOString(),
            },
          ],
        }));
        return id;
      },
    }),
    {
      name: "hermes-ui-state",
      storage: createJSONStorage(() => serverStorage),
      // Rehydrate manually after mount to avoid SSR hydration mismatches.
      skipHydration: true,
      partialize: (s) => ({
        chats: s.chats,
        projects: s.projects,
        artifacts: s.artifacts,
      }),
      onRehydrateStorage: () => () => {
        useHermesStore.setState({ _hasHydrated: true });
      },
    }
  )
);
