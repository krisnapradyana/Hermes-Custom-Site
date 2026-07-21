"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderKanban, Package, HardDrive, PanelRight } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { Composer } from "@/components/Composer";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { useResizableWidth, ResizeHandle } from "@/components/ResizeHandle";

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const project = useHermesStore((s) => s.projects.find((p) => p.id === id));
  // Select raw arrays (stable references) and derive with useMemo —
  // filtering inside the selector returns a fresh array every read and
  // causes an infinite re-render loop.
  const allChats = useHermesStore((s) => s.chats);
  const allArtifacts = useHermesStore((s) => s.artifacts);
  const chats = useMemo(() => allChats.filter((c) => c.projectId === id), [allChats, id]);
  const artifacts = useMemo(
    () =>
      allArtifacts.filter(
        (a) => a.chatId && allChats.some((c) => c.id === a.chatId && c.projectId === id)
      ),
    [allArtifacts, allChats, id]
  );
  const createChat = useHermesStore((s) => s.createChat);
  const loadProjects = useHermesStore((s) => s.loadProjects);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

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
          onSend={(t, a) => {
            const chatId = createChat(t, project.id, a);
            router.push(`/chat/${chatId}`);
          }}
        />
      </div>

      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint mb-3">
        Conversations
      </h2>
      <div className="space-y-2 mb-10">
        {chats.map((c) => (
          <Link
            key={c.id}
            href={`/chat/${c.id}`}
            className="block rounded-xl border border-line bg-card px-4 py-3 hover:border-ink-faint transition-colors"
          >
            <p className="text-sm font-medium">{c.title}</p>
            <p className="text-[12px] text-ink-faint">
              {c.messages.length} messages · updated {timeAgo(c.updatedAt)}
            </p>
          </Link>
        ))}
        {chats.length === 0 && (
          <p className="text-sm text-ink-faint">No conversations in this project yet.</p>
        )}
      </div>

      {artifacts.length > 0 && (
        <>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint mb-3">
            Artifacts
          </h2>
          <div className="space-y-2">
            {artifacts.map((a) => (
              <Link
                key={a.id}
                href={`/artifacts?open=${a.id}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 hover:border-ink-faint transition-colors"
              >
                <Package size={15} className="text-accent" />
                <div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="text-[12px] text-ink-faint capitalize">
                    {a.kind} · updated {timeAgo(a.updatedAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
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
