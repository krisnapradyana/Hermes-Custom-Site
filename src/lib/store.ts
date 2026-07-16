"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Chat, Message, Project, Artifact, CronJob } from "./types";
import { hermesRespond } from "./hermes-api";
import { extractArtifacts } from "./extract";

let counter = 0;
const uid = (p: string) => `${p}-${Date.now()}-${counter++}`;

interface HermesState {
  chats: Chat[];
  projects: Project[];
  artifacts: Artifact[];
  cronJobs: CronJob[];
  isStreaming: boolean;
  _hasHydrated: boolean;

  createChat: (firstMessage: string, projectId?: string) => string;
  sendMessage: (chatId: string, content: string) => void;
  togglePin: (chatId: string) => void;
  deleteChat: (chatId: string) => void;
  renameChat: (chatId: string, title: string) => void;

  createProject: (name: string, description: string) => string;

  toggleCron: (id: string) => void;
  createCron: (job: Omit<CronJob, "id">) => void;
  deleteCron: (id: string) => void;
}

export const useHermesStore = create<HermesState>()(
  persist(
    (set, get) => ({
      chats: [],
      projects: [],
      artifacts: [],
      cronJobs: [],
      isStreaming: false,
      _hasHydrated: false,

      createChat: (firstMessage, projectId) => {
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
        get().sendMessage(id, firstMessage);
        return id;
      },

      sendMessage: (chatId, content) => {
        const now = new Date().toISOString();
        const userMsg: Message = { id: uid("m"), role: "user", content, createdAt: now };
        const chat = get().chats.find((c) => c.id === chatId);
        const priorHistory = chat?.messages ?? [];
        set((s) => ({
          isStreaming: true,
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, userMsg], updatedAt: now }
              : c
          ),
        }));

        hermesRespond(content, priorHistory).then((reply) => {
          // Promote substantial code blocks in the reply to artifacts.
          const newArtifacts = extractArtifacts(
            reply,
            chatId,
            chat?.title ?? "Conversation",
            () => uid("art")
          );

          const replyMsg: Message = {
            id: uid("m"),
            role: "assistant",
            content: reply,
            createdAt: new Date().toISOString(),
            artifactId: newArtifacts[0]?.id,
          };

          set((s) => ({
            isStreaming: false,
            artifacts: [...s.artifacts, ...newArtifacts],
            chats: s.chats.map((c) =>
              c.id === chatId
                ? { ...c, messages: [...c.messages, replyMsg], updatedAt: replyMsg.createdAt }
                : c
            ),
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

      toggleCron: (id) =>
        set((s) => ({
          cronJobs: s.cronJobs.map((j) =>
            j.id === id ? { ...j, enabled: !j.enabled } : j
          ),
        })),

      createCron: (job) =>
        set((s) => ({ cronJobs: [...s.cronJobs, { ...job, id: uid("cron") }] })),

      deleteCron: (id) =>
        set((s) => ({ cronJobs: s.cronJobs.filter((j) => j.id !== id) })),
    }),
    {
      name: "hermes-ui-state",
      storage: createJSONStorage(() => localStorage),
      // Rehydrate manually after mount to avoid SSR hydration mismatches.
      skipHydration: true,
      partialize: (s) => ({
        chats: s.chats,
        projects: s.projects,
        artifacts: s.artifacts,
        cronJobs: s.cronJobs,
      }),
      onRehydrateStorage: () => () => {
        useHermesStore.setState({ _hasHydrated: true });
      },
    }
  )
);
