"use client";

import { use, useEffect, useRef } from "react";
import Link from "next/link";
import { Pin, PinOff, Trash2, FolderKanban } from "lucide-react";
import { useRouter } from "next/navigation";
import { useHermesStore } from "@/lib/store";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const chat = useHermesStore((s) => s.chats.find((c) => c.id === id));
  const projects = useHermesStore((s) => s.projects);
  const isStreaming = useHermesStore((s) => s.isStreaming);
  const sendMessage = useHermesStore((s) => s.sendMessage);
  const togglePin = useHermesStore((s) => s.togglePin);
  const deleteChat = useHermesStore((s) => s.deleteChat);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length, isStreaming]);

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint text-sm">
        Conversation not found.
      </div>
    );
  }

  const project = chat.projectId ? projects.find((p) => p.id === chat.projectId) : undefined;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-line bg-parchment/80 backdrop-blur px-6 py-3 sticky top-0 z-10">
        <div className="min-w-0">
          <h1 className="text-[15px] font-medium truncate">{chat.title}</h1>
          {project && (
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink-soft"
            >
              <FolderKanban size={10} />
              {project.name}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => togglePin(chat.id)}
            className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
            title={chat.pinned ? "Unpin" : "Pin"}
          >
            {chat.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button
            onClick={() => {
              deleteChat(chat.id);
              router.push("/");
            }}
            className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft hover:text-red-600"
            title="Delete chat"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <MessageList messages={chat.messages} streaming={isStreaming} />
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-line bg-parchment px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <Composer onSend={(t) => sendMessage(chat.id, t)} disabled={isStreaming} />
        </div>
      </div>
    </div>
  );
}
