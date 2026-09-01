"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  FolderKanban,
  PanelRight,
  User,
  MessageSquare,
  ListChecks,
  Archive,
  Pencil,
  FileText,
} from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { api } from "@/lib/api";
import { IconButton } from "@/components/ui";
import { Composer } from "@/components/Composer";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { ProjectTeam } from "@/components/ProjectTeam";
import { ProductionTracker } from "@/components/ProductionTracker";
import { useFocusRefresh } from "@/lib/use-focus-refresh";
import { useResizableWidth, ResizeHandle } from "@/components/ResizeHandle";
import { ConversationMeta, Attachment, Artifact } from "@/lib/types";
import { Paperclip, Package, Table2 } from "lucide-react";
import { AttachmentPreview, attachmentIconKind } from "@/components/AttachmentPreview";
import { ArtifactPreview } from "@/components/ArtifactPreview";

type Tab = "conversations" | "production" | "attachments" | "artifacts";
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
  const { data: session } = useSession();
  const mySlackId = session?.user?.slackId;
  const project = useHermesStore((s) => s.projects.find((p) => p.id === id));
  const loadProjects = useHermesStore((s) => s.loadProjects);
  const updateProject = useHermesStore((s) => s.updateProject);

  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const loadConversations = useCallback(async () => {
    const res = await api.get<{ conversations?: ConversationMeta[] }>(
      `/api/projects/${encodeURIComponent(id)}/conversations`
    );
    if (res.ok) setConversations(res.data.conversations ?? []);
    else console.warn(`[project] load conversations failed: ${res.error}`);
  }, [id]);

  useEffect(() => {
    loadProjects();
    loadConversations();
  }, [loadProjects, loadConversations]);

  // Coming back to the tab → instant refresh.
  useFocusRefresh(
    useCallback(() => {
      loadProjects();
      loadConversations();
    }, [loadProjects, loadConversations])
  );

  const startConversation = async (text: string) => {
    const res = await api.post<{ conversation: ConversationMeta }>(
      `/api/projects/${encodeURIComponent(id)}/conversations`,
      { title: text }
    );
    if (!res.ok) {
      console.warn(`[project] create conversation failed: ${res.error}`);
      return;
    }
    const { conversation } = res.data;
    try {
      sessionStorage.setItem(`pending-msg-${conversation.id}`, text);
    } catch {}
    router.push(`/conversation/${conversation.id}`);
  };

  const [showPanel, setShowPanel] = useState(true);
  const ws = useResizableWidth("hermes-workspace-w", 320, 240, 640, true);

  // "Summarize" — fetch the server-built prompt, open a fresh conversation
  // with it, and let the agent produce the document in plain sight.
  const [summarizing, setSummarizing] = useState(false);
  const summarize = async () => {
    if (summarizing) return;
    setSummarizing(true);
    try {
      const res = await api.get<{ prompt: string; title: string }>(
        `/api/projects/${encodeURIComponent(id)}/summary`
      );
      if (!res.ok) {
        console.warn(`[project] summary prompt failed: ${res.error}`);
        return;
      }
      const created = await api.post<{ conversation: ConversationMeta }>(
        `/api/projects/${encodeURIComponent(id)}/conversations`,
        { title: res.data.title }
      );
      if (!created.ok) return;
      try {
        sessionStorage.setItem(`pending-msg-${created.data.conversation.id}`, res.data.prompt);
      } catch {}
      router.push(`/conversation/${created.data.conversation.id}`);
    } finally {
      setSummarizing(false);
    }
  };

  // Inline edit of name & description (folder stays immutable — see API).
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const saveEdit = async () => {
    if (!editName.trim() || !editStart || !editEnd || saving) return;
    setSaving(true);
    await updateProject(id, {
      name: editName.trim(),
      description: editDesc.trim(),
      startDate: editStart,
      deadline: editEnd,
    });
    setSaving(false);
    setEditing(false);
  };

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
    (async () => {
      const res = await api.get<{ attachments: AttachmentItem[]; artifacts: ArtifactItem[] }>(
        `/api/projects/${encodeURIComponent(id)}/collect`
      );
      if (!res.ok) console.warn(`[project] collect failed: ${res.error}`);
      else if (res.data) setCollected(res.data);
    })();
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
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-8 pt-10 pb-6">
          <div className="flex items-center justify-between mb-6">
            <Link
              prefetch={false}
              href="/projects"
              className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
            >
              <ArrowLeft size={14} />
              All projects
            </Link>
            <div className="flex items-center gap-1.5">
              {/* Summarize: opens a conversation where the agent writes the
                  official project summary doc into the working folder. */}
              <button
                onClick={summarize}
                disabled={summarizing}
                className="flex items-center gap-1.5 rounded-lg border border-accent/50 bg-accent-soft/40 px-2.5 py-1.5 text-[12px] text-accent hover:bg-accent-soft transition-colors disabled:opacity-50"
                title="Generate an official project summary document (saved to the project folder)"
              >
                <FileText size={13} />
                {summarizing ? "Preparing…" : "Summarize"}
              </button>
              {/* Edit name / description / schedule — always visible. */}
              <button
                onClick={() => {
                  setEditName(project.name ?? "");
                  setEditDesc(project.description ?? "");
                  setEditStart(project.startDate ?? "");
                  setEditEnd(project.deadline ?? "");
                  setEditing(true);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-soft hover:border-ink-faint hover:text-ink transition-colors"
                title="Edit name, description and schedule"
              >
                <Pencil size={13} />
                Edit
              </button>
              {/* Archive: hides the project from the clock-in menu (reversible). */}
              <button
                onClick={() => updateProject(project.id, { archived: !project.archived })}
                title={
                  project.archived
                    ? "Unarchive — show in the clock-in menu again"
                    : "Archive — hide from the clock-in menu"
                }
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
                  project.archived
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                    : "border-line text-ink-soft hover:border-ink-faint hover:text-ink"
                }`}
              >
                <Archive size={13} />
                {project.archived ? "Archived — unarchive" : "Archive"}
              </button>
              {hasPanel && (
                <IconButton
                  onClick={() => setShowPanel((v) => !v)}
                  title={showPanel ? "Hide workspace panel" : "Show workspace panel"}
                  active={showPanel}
                >
                  <PanelRight size={15} />
                </IconButton>
              )}
            </div>
          </div>

          {editing ? (
            <div className="mb-5 rounded-xl border border-line bg-card p-4 space-y-2.5">
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Project name"
                className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-lg font-medium outline-none focus:border-ink-faint"
              />
              <input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                placeholder="What is this project about?"
                className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
              />
              <div className="flex gap-3">
                <label className="flex-1">
                  <span className="block text-[12px] font-medium mb-1 text-ink-soft">
                    Start date
                  </span>
                  <input
                    type="date"
                    value={editStart}
                    onChange={(e) => setEditStart(e.target.value)}
                    className="w-full rounded-lg border border-line bg-transparent px-3 py-1.5 text-sm outline-none focus:border-ink-faint"
                  />
                </label>
                <label className="flex-1">
                  <span className="block text-[12px] font-medium mb-1 text-ink-soft">Deadline</span>
                  <input
                    type="date"
                    value={editEnd}
                    min={editStart || undefined}
                    onChange={(e) => setEditEnd(e.target.value)}
                    className="w-full rounded-lg border border-line bg-transparent px-3 py-1.5 text-sm outline-none focus:border-ink-faint"
                  />
                </label>
              </div>
              <p className="text-[11px] text-ink-faint">
                The working folder can&apos;t be changed — name, description and schedule only. The
                timeline, deadline badges and Task Board follow the new dates immediately.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={!editName.trim() || !editStart || !editEnd || saving}
                  className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg px-3 py-1.5 text-[13px] text-ink-soft hover:bg-parchment-dark"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
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
            </>
          )}

          {/* Task board lives on its own page — tasks are work, not chat. */}
          <Link
            prefetch={false}
            href={`/projects/${encodeURIComponent(project.id)}/tasks`}
            className="mb-3 flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 hover:border-ink-faint transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center shrink-0">
              <ListChecks size={15} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Task Board</p>
              <p className="text-[12px] text-ink-faint">
                Assign work and track iteration — opens its own page
              </p>
            </div>
            {(project.startDate || project.deadline) && (
              <span className="text-[12px] text-ink-faint shrink-0">
                {project.startDate
                  ? new Date(`${project.startDate}T00:00:00`).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })
                  : "…"}{" "}
                →{" "}
                {project.deadline
                  ? new Date(`${project.deadline}T00:00:00`).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })
                  : "…"}
              </span>
            )}
          </Link>

          {/* Who is on this project — scoped Team Pulse with jump-links. */}
          <ProjectTeam projectId={project.id} />

          {/* Tabs */}
          <div className="flex items-center gap-1 mb-4 border-b border-line">
            {(
              [
                ["conversations", "Conversations", <MessageSquare key="c" size={13} />],
                ["production", "Production", <Table2 key="t" size={13} />],
                ["attachments", "Attachments", <Paperclip key="p" size={13} />],
                ["artifacts", "Artifacts", <Package key="a" size={13} />],
              ] as [Tab, string, React.ReactNode][]
            ).map(([key, label, icon]) => (
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

          {tab === "production" && <ProductionTracker projectId={project.id} />}

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
                {conversations.map((c) => {
                  // My own conversations pop out — accent edge + "You".
                  const mine =
                    !!c.createdBy?.slackId && c.createdBy.slackId === mySlackId;
                  return (
                    <Link
                      prefetch={false}
                      key={c.id}
                      href={`/conversation/${c.id}`}
                      className={`block rounded-xl border px-4 py-3 transition-colors ${
                        mine
                          ? "border-accent/50 border-l-[3px] border-l-accent bg-accent-soft/30 hover:border-accent"
                          : "border-line bg-card hover:border-ink-faint"
                      }`}
                    >
                      <p className="text-sm font-medium">{c.title}</p>
                      <p className="flex items-center gap-2 text-[12px] text-ink-faint">
                        <span className="inline-flex items-center gap-1">
                          <MessageSquare size={11} />
                          {c.messageCount}
                        </span>
                        {c.createdBy?.name && (
                          <span
                            className={`inline-flex items-center gap-1 ${
                              mine ? "text-accent font-medium" : ""
                            }`}
                          >
                            <User size={11} />
                            {mine ? "You" : c.createdBy.name}
                          </span>
                        )}
                        <span>· updated {timeAgo(c.updatedAt)}</span>
                      </p>
                    </Link>
                  );
                })}
                {conversations.length === 0 && (
                  <p className="text-sm text-ink-faint">No conversations in this project yet.</p>
                )}
              </div>
            </>
          )}
          </div>
        </div>

        {/* Composer pinned at the bottom — same feel as a normal chat. */}
        <div className="shrink-0 border-t border-line px-8 py-4">
          <div className="mx-auto max-w-4xl">
            <Composer
              placeholder={`New conversation in ${project.name}…`}
              onSend={(t) => startConversation(t)}
              projectId={project.id}
            />
          </div>
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
                  prefetch={false}
                  href={`/conversation/${openAtt.conversationId}`}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                  title="Open conversation"
                >
                  <MessageSquare size={15} />
                </Link>
                <IconButton onClick={() => setOpenAtt(null)} title="Close">
                  ✕
                </IconButton>
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
                  prefetch={false}
                  href={`/conversation/${openArt.conversationId}`}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                  title="Open conversation"
                >
                  <MessageSquare size={15} />
                </Link>
                <IconButton onClick={() => setOpenArt(null)} title="Close">
                  ✕
                </IconButton>
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
