"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Pin,
  PinOff,
  Trash2,
  FolderKanban,
  X,
  Copy,
  Check,
  Download,
  PanelRight,
  ArrowLeft,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useHermesStore } from "@/lib/store";
import { rehydrateAttachments } from "@/lib/hermes-api";
import { stopTurn } from "@/lib/send-turn";
import { IconButton, EmptyState, ScreenHeader, SidePanel } from "@/components/ui";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";
import { ArtifactPreview, downloadArtifact } from "@/components/ArtifactPreview";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { TokenMeter } from "@/components/TokenMeter";
import { useResizableWidth, ResizeHandle } from "@/components/ResizeHandle";

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
  const ensureChatLoaded = useHermesStore((s) => s.ensureChatLoaded);
  const chatsLoaded = useHermesStore((s) => s._chatsLoaded);

  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(true);
  const ws = useResizableWidth("hermes-workspace-w", 320, 240, 640, true);
  const art = useResizableWidth("hermes-artifact-w", 560, 320, 960, true);
  const openArtifact = openArtifactId ? artifacts.find((a) => a.id === openArtifactId) : undefined;

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length, isStreaming]);

  // Messages are stored per chat and fetched on open (the list only carries
  // metadata), so pull them in as soon as this page mounts.
  useEffect(() => {
    ensureChatLoaded(id);
  }, [id, ensureChatLoaded]);

  if (!chat) {
    return <EmptyState>{chatsLoaded ? "Conversation not found." : "Loading…"}</EmptyState>;
  }

  const project = chat.projectId ? projects.find((p) => p.id === chat.projectId) : undefined;

  return (
    <div className="flex h-full">
      {/* Chat column */}
      <div className="flex h-full flex-col flex-1 min-w-0">
        <ScreenHeader
          left={
            <>
              <IconButton
                onClick={() => router.push(project ? `/projects/${project.id}` : "/")}
                title={project ? `Back to ${project.name}` : "Back to home"}
                className="-ml-1.5 shrink-0"
              >
                <ArrowLeft size={16} />
              </IconButton>
              <div className="min-w-0">
                <h1 className="text-[15px] font-medium truncate">{chat.title}</h1>
                {project && (
                  <Link
                    prefetch={false}
                    href={`/projects/${project.id}`}
                    className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink-soft"
                  >
                    <FolderKanban size={10} />
                    {project.name}
                  </Link>
                )}
              </div>
            </>
          }
          right={
            <>
              <TokenMeter
                sessionId={chat.id}
                refreshKey={isStreaming ? "live" : chat.messages.length}
              />
              {project && (
                <IconButton
                  onClick={() => setShowWorkspace(!showWorkspace)}
                  active={showWorkspace}
                  title={showWorkspace ? "Hide workspace panel" : "Show workspace panel"}
                >
                  <PanelRight size={15} />
                </IconButton>
              )}
              <IconButton onClick={() => togglePin(chat.id)} title={chat.pinned ? "Unpin" : "Pin"}>
                {chat.pinned ? <PinOff size={15} /> : <Pin size={15} />}
              </IconButton>
              <IconButton
                onClick={() => {
                  deleteChat(chat.id);
                  router.push("/");
                }}
                danger
                title="Delete chat"
              >
                <Trash2 size={15} />
              </IconButton>
            </>
          }
        />

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <MessageList
              messages={chat.messages}
              streaming={isStreaming}
              onOpenArtifact={setOpenArtifactId}
              onRetry={async (text, atts) =>
                sendMessage(chat.id, text, await rehydrateAttachments(atts))
              }
            />
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-line bg-parchment px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <Composer
              onSend={(t, a) => sendMessage(chat.id, t, a)}
              disabled={isStreaming}
              onStop={() => stopTurn(chat.id)}
            />
          </div>
        </div>
      </div>

      {/* Artifact panel */}
      {openArtifact && <ResizeHandle onPointerDown={art.startResize} />}
      {openArtifact && (
        <SidePanel width={art.width}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{openArtifact.title}</p>
              <p className="text-[11px] text-ink-faint capitalize">
                {openArtifact.kind}
                {openArtifact.language && ` · ${openArtifact.language}`}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <IconButton onClick={() => downloadArtifact(openArtifact)} title="Download">
                <Download size={15} />
              </IconButton>
              <IconButton
                onClick={() => {
                  navigator.clipboard.writeText(openArtifact.content);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                title="Copy content"
              >
                {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
              </IconButton>
              <IconButton onClick={() => setOpenArtifactId(null)} title="Close">
                <X size={15} />
              </IconButton>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <ArtifactPreview artifact={openArtifact} />
          </div>
        </SidePanel>
      )}

      {/* Workspace panel (project chats; artifact view takes priority) */}
      {!openArtifact && project && showWorkspace && (
        <>
          <ResizeHandle onPointerDown={ws.startResize} />
          <SidePanel width={ws.width}>
            <WorkspacePanel project={project} />
          </SidePanel>
        </>
      )}
    </div>
  );
}
