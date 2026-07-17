"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FolderKanban, Package, HardDrive, Pencil, Check } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { Composer } from "@/components/Composer";
import { FolderInput } from "@/components/FolderInput";

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
  const updateProject = useHermesStore((s) => s.updateProject);

  const [editingFolders, setEditingFolders] = useState(false);
  const [wf, setWf] = useState("");
  const [df, setDf] = useState("");
  const [wfOk, setWfOk] = useState(false);
  const [dfOk, setDfOk] = useState(true);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint text-sm">
        Project not found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink mb-6"
      >
        <ArrowLeft size={14} />
        All projects
      </Link>

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

      {/* Folders */}
      <div className="mb-8 rounded-xl border border-line bg-card px-4 py-3">
        {!editingFolders ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-1.5 text-[13px] font-mono truncate">
                <HardDrive size={13} className="text-accent shrink-0" />
                {project.workingFolder ?? (
                  <span className="text-red-500 font-sans">No working folder set</span>
                )}
              </div>
              {project.driveFolder && (
                <div className="flex items-center gap-1.5 text-[13px] font-mono text-ink-soft truncate">
                  <HardDrive size={13} className="shrink-0" />
                  {project.driveFolder}
                  <span className="text-[10px] text-ink-faint font-sans">(Drive)</span>
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setWf(project.workingFolder ?? "");
                setDf(project.driveFolder ?? "");
                setEditingFolders(true);
              }}
              className="p-1.5 rounded-lg hover:bg-parchment-dark text-ink-faint hover:text-ink shrink-0"
              title="Edit folders"
            >
              <Pencil size={13} />
            </button>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <FolderInput label="Working folder" value={wf} onChange={setWf} onStatus={setWfOk} />
            <FolderInput
              label="Google Drive folder"
              optional
              value={df}
              onChange={setDf}
              onStatus={setDfOk}
              placeholder="G:\My Drive\ProjectAssets"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!wfOk || !dfOk) return;
                  updateProject(project.id, {
                    workingFolder: wf.trim(),
                    driveFolder: df.trim() || undefined,
                  });
                  setEditingFolders(false);
                }}
                disabled={!wfOk || !dfOk}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Check size={13} />
                Save
              </button>
              <button
                onClick={() => setEditingFolders(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-parchment-dark"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mb-10">
        {project.workingFolder ? (
          <Composer
            placeholder={`New conversation in ${project.name}…`}
            onSend={(t, a) => {
              const chatId = createChat(t, project.id, a);
              router.push(`/chat/${chatId}`);
            }}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-card px-5 py-6 text-center">
            <p className="text-sm text-ink-soft mb-1">
              Set a working folder before starting conversations in this project.
            </p>
            <p className="text-[12px] text-ink-faint">
              The assistant uses it for all file work — click the pencil above to set it.
            </p>
          </div>
        )}
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
  );
}
