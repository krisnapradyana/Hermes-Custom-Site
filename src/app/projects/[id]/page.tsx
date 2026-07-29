"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderKanban, HardDrive, PanelRight, User, MessageSquare } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { Composer } from "@/components/Composer";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { useResizableWidth, ResizeHandle } from "@/components/ResizeHandle";
import { ConversationMeta, Attachment, Artifact } from "@/lib/types";
import { Paperclip, Package } from "lucide-react";
import { AttachmentPreview, attachmentIconKind } from "@/components/AttachmentPreview";
import { ArtifactPreview } from "@/components/ArtifactPreview";

type Tab = "conversations" | "attachments" | "artifacts";
interface AttachmentItem extends Attachment {
  conversationId: string;
  conversationTitle: string;
  by?: string;
  at: string;
}
type ArtifactItem = Artifact & { conversationId: string; by?: string };

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const project = useHermesStore((s) => s.projects.find((p) => p.id === id));
  const loadProjects = useHermesStore((s) => s.loadProjects);

  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/conversations`, {
        cache: "no-store",
      });
      if (res.ok) setConversations((await res.json()).conversations ?? []);
    } catch {}
  }, [id]);

  useEffect(() => {
    loadProjects();
    loadConversations();
  }, [loadProjects, loadConversations]);

  const startConversation = async (text: string) => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: text }),
      });
      if (!res.ok) return;
      const { conversation } = await res.json();
      try {
        sessionStorage.setItem(`pending-msg-${conversation.id}`, text);
      } catch {}
      router.push(`/conversation/${conversation.id}`);
    } catch {}
  };

  const [showPanel, setShowPanel] = useState(true);
  const ws = useResizableWidth("hermes-workspace-w", 320, 240, 640, true);

  // Project-wide Attachments / Artifacts, gathered from shared conversations.
  const [tab, setTab] = useState<Tab>("conversations");
  const [collected, setCollected] = useState<{
    attachments: AttachmentItem[];
    artifacts: ArtifactItem[];
  } | null>(null);
  const [openAtt, setOpenAtt] = useState<AttachmentItem | null>(null);
  const [openArt, setOpenArt] = useState<ArtifactItem | null>(null);

  useEffect(() => {
    if (tab === "conversations" || collected) return;
    fetch(`/api/projects/${encodeURIComponent(id)}/collect`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCollected(d))
      .catch(() => {});
  }, [tab, collected, id]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint text-sm">
        Project not found.
      </div>
    );
  }

  const hasPanel = !!project.workingFolder;

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-8 py-10">
          <div className="flex items-center justify-between mb-6">
            <Link
              href="/projects"
              className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
            >
              <ArrowLeft size={14} />
              All projects
            </Link>
            {hasPanel && (
              <button
                onClick={() => setShowPanel((v) => !v)}
                className={`p-2 rounded-lg hover:bg-parchment-dark ${
                  showPanel ? "text-accent" : "text-ink-soft"
                }`}
                title={showPanel ? "Hide workspace panel" : "Show workspace panel"}
              >
                <PanelRight size={15} />
              </button>
            )}
          </div>

      <div className="flex items-center gap-3 mb-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${project.color}22` }}
        >
          <FolderKanban size={18} style={{ color: project.color }} />
        </div>
        <h1 className="font-serif-display text-3xl">{project.name}</h1>
      </div>
      <p className="text-ink-soft mb-5">{project.description}</p>

      {/* Working folder — fixed at creation, not editable */}
      <div className="mb-8 rounded-xl border border-line bg-card px-4 py-3">
        <div className="flex items-center gap-1.5 text-[13px] font-mono truncate">
          <HardDrive size={13} className="text-accent shrink-0" />
          {project.workingFolder ?? <span className="text-ink-faint font-sans">No working folder</span>}
        </div>
      </div>

      <div className="mb-10">
        <Composer
          placeholder={`New conversation in ${project.name}…`}
          onSend={(t) => startConversation(t)}
          projectId={project.id}
        />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-line">
        {([
          ["conversations", "Conversations", <MessageSquare key="c" size={13} />],
          ["attachments", "Attachments", <Paperclip key="p" size={13} />],
          ["artifacts", "Artifacts", <Package key="a" size={13} />],
        ] as [Tab, string, React.ReactNode][]).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-accent text-accent font-medium"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {icon}
            {label}
            {key === "attachments" && collected && (
              <span className="text-[11px] text-ink-faint">{collected.attachments.length}</span>
            )}
            {key === "artifacts" && collected && (
              <span className="text-[11px] text-ink-faint">{collected.artifacts.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "attachments" && (
        <div className="space-y-2 mb-10">
          <p className="text-[12px] text-ink-faint mb-2">
            Files uploaded into this project&apos;s conversations by anyone on the team.
          </p>
          {!collected && <p className="text-sm text-ink-faint">Loading…</p>}
          {collected?.attachments.map((a, i) => (
            <button
              key={`${a.id ?? a.name}-${i}`}
              onClick={() => setOpenAtt(a)}
              className="w-full text-left rounded-xl border border-line bg-card px-4 py-3 hover:border-ink-faint transition-colors"
            >
              <p className="text-sm font-medium truncate">{a.name}</p>
              <p className="text-[12px] text-ink-faint">
                {attachmentIconKind(a)} · {a.by ? `${a.by} · ` : ""}
                {timeAgo(a.at)} · in &ldquo;{a.conversationTitle}&rdquo;
              </p>
            </button>
          ))}
          {collected && collected.attachments.length === 0 && (
            <p className="text-sm text-ink-faint">No attachments in this project yet.</p>
          )}
        </div>
      )}

      {tab === "artifacts" && (
        <div className="space-y-2 mb-10">
          <p className="text-[12px] text-ink-faint mb-2">
            Code and documents the assistant produced in this project&apos;s conversations.
          </p>
          {!collected && <p className="text-sm text-ink-faint">Loading…</p>}
          {collected?.artifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpenArt(a)}
              className="w-full text-left rounded-xl border border-line bg-card px-4 py-3 hover:border-ink-faint transition-colors"
            >
              <p className="text-sm font-medium truncate">{a.title}</p>
              <p className="text-[12px] text-ink-faint capitalize">
                {a.kind}
                {a.language ? ` · ${a.language}` : ""} · {a.by ? `${a.by} · ` : ""}
                {timeAgo(a.createdAt)}
              </p>
            </button>
          ))}
          {collected && collected.artifacts.length === 0 && (
            <p className="text-sm text-ink-faint">No artifacts in this project yet.</p>
          )}
        </div>
      )}

      {tab === "conversations" && (
      <>
      <p className="text-[12px] text-ink-faint mb-3">
        Shared with everyone on the team — only the person who started each can reply.
      </p>
      <div className="space-y-2 mb-10">
        {conversations.map((c) => (
          <Link
            key={c.id}
            href={`/conversation/${c.id}`}
            className="block rounded-xl border border-line bg-card px-4 py-3 hover:border-ink-faint transition-colors"
          >
            <p className="text-sm font-medium">{c.title}</p>
            <p className="flex items-center gap-2 text-[12px] text-ink-faint">
              <span className="inline-flex items-center gap-1">
                <MessageSquare size={11} />
                {c.messageCount}
              </span>
              {c.createdBy?.name && (
                <span className="inline-flex items-center gap-1">
                  <User size={11} />
                  {c.createdBy.name}
                </span>
              )}
              <span>· updated {timeAgo(c.updatedAt)}</span>
            </p>
          </Link>
        ))}
        {conversations.length === 0 && (
          <p className="text-sm text-ink-faint">No conversations in this project yet.</p>
        )}
      </div>
      </>
      )}
        </div>
      </div>

      {/* Preview overlays */}
      {openAtt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setOpenAtt(null)}
        >
          <div
            className="w-full max-w-3xl h-[80vh] rounded-2xl border border-line bg-card flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-sm font-medium truncate">{openAtt.name}</p>
              <div className="flex items-center gap-1">
                <Link
                  href={`/conversation/${openAtt.conversationId}`}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                  title="Open conversation"
                >
                  <MessageSquare size={15} />
                </Link>
                <button
                  onClick={() => setOpenAtt(null)}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <AttachmentPreview attachment={openAtt} />
            </div>
          </div>
        </div>
      )}

      {openArt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setOpenArt(null)}
        >
          <div
            className="w-full max-w-3xl h-[80vh] rounded-2xl border border-line bg-card flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-sm font-medium truncate">{openArt.title}</p>
              <div className="flex items-center gap-1">
                <Link
                  href={`/conversation/${openArt.conversationId}`}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                  title="Open conversation"
                >
                  <MessageSquare size={15} />
                </Link>
                <button
                  onClick={() => setOpenArt(null)}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <ArtifactPreview artifact={openArt} />
            </div>
          </div>
        </div>
      )}

      {hasPanel && showPanel && (
        <>
          <ResizeHandle onPointerDown={ws.startResize} />
          <div
            className="shrink-0 border-l border-line bg-card flex flex-col"
            style={{ width: ws.width }}
          >
            <WorkspacePanel project={project} />
          </div>
        </>
      )}
    </div>
  );
}
