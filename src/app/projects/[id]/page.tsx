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
import { ConversationMeta } from "@/lib/types";

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
        />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint mb-1">
        Conversations
      </h2>
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
        </div>
      </div>

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
