"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pin, PinOff, Trash2, FolderKanban, X, Copy, Check, Download, PanelRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useHermesStore } from "@/lib/store";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";
import { ArtifactPreview, downloadArtifact } from "@/components/ArtifactPreview";
import { WorkspacePanel } from "@/components/WorkspacePanel";

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const chat = useHermesStore((s) => s.chats.find((c) => c.id === id));
  const projects = useHermesStore((s) => s.projects);
  const artifacts = useHermesStore((s) => s.artifacts);
  const isStreaming = useHermesStore((s) => s.isStreaming);
  const sendMessage = useHermesStore((s) => s.sendMessage);
  const togglePin = useHermesStore((s) => s.togglePin);
  const deleteChat = useHermesStore((s) => s.deleteChat);

  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(true);
  const openArtifact = openArtifactId ? artifacts.find((a) => a.id === openArtifactId) : undefined;

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
    <div className="flex h-full">
      {/* Chat column */}
      <div className="flex h-full flex-col flex-1 min-w-0">
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
            {project && (
              <button
                onClick={() => setShowWorkspace(!showWorkspace)}
                className={`p-2 rounded-lg hover:bg-parchment-dark ${
                  showWorkspace ? "text-accent" : "text-ink-soft"
                }`}
                title={showWorkspace ? "Hide workspace panel" : "Show workspace panel"}
              >
                <PanelRight size={15} />
              </button>
            )}
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

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <MessageList
              messages={chat.messages}
              streaming={isStreaming}
              onOpenArtifact={setOpenArtifactId}
            />
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-line bg-parchment px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <Composer onSend={(t, a) => sendMessage(chat.id, t, a)} disabled={isStreaming} />
          </div>
        </div>
      </div>

      {/* Artifact panel */}
      {openArtifact && (
        <div className="w-[44%] min-w-80 border-l border-line bg-card flex flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{openArtifact.title}</p>
              <p className="text-[11px] text-ink-faint capitalize">
                {openArtifact.kind}
                {openArtifact.language && ` · ${openArtifact.language}`}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => downloadArtifact(openArtifact)}
                className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                title="Download"
              >
                <Download size={15} />
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(openArtifact.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                title="Copy content"
              >
                {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
              </button>
              <button
                onClick={() => setOpenArtifactId(null)}
                className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <ArtifactPreview artifact={openArtifact} />
          </div>
        </div>
      )}

      {/* Workspace panel (project chats; artifact view takes priority) */}
      {!openArtifact && project && showWorkspace && (
        <div className="w-80 shrink-0 border-l border-line bg-card flex flex-col">
          <WorkspacePanel project={project} />
        </div>
      )}
    </div>
  );
}
