"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, FolderKanban, MessageSquare, HardDrive, Trash2, User, Search,
  ChevronDown, ChevronRight, CornerDownRight,
} from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { ServerFolderPicker } from "@/components/ServerFolderPicker";
import { Project } from "@/lib/types";

interface Thumb {
  sub: string;
  mtimeMs: number;
}
interface Summary {
  id: string;
  conversationCount: number;
  latest: { id: string; title: string; updatedAt: string; by?: string } | null;
  lastActivityAt: string;
  activeNow: boolean;
  thumbs: Thumb[];
}

const GROUP_MIN = 8; // fewer projects than this → flat grid, no month headers
const COLLAPSE_KEY = "hermes-proj-collapsed";

const monthKey = (iso: string) => iso.slice(0, 7); // "2026-07"
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const name = new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long" });
  return y === new Date().getFullYear() ? name : `${name} ${y}`;
}

export default function ProjectsPage() {
  const router = useRouter();
  const projects = useHermesStore((s) => s.projects);
  const chats = useHermesStore((s) => s.chats);
  const createProject = useHermesStore((s) => s.createProject);
  const deleteProject = useHermesStore((s) => s.deleteProject);
  const loadProjects = useHermesStore((s) => s.loadProjects);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // ---- live summary (counts, latest conversation, activity, thumbnails) ----
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/projects/summary", { cache: "no-store" });
      if (!res.ok) return;
      const { summaries } = (await res.json()) as { summaries: Summary[] };
      setSummaries(Object.fromEntries(summaries.map((s) => [s.id, s])));
    } catch {}
  }, []);
  useEffect(() => {
    loadSummary();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadSummary();
    }, 45_000);
    return () => clearInterval(t);
  }, [loadSummary]);

  // ---- search ----
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- collapsed month groups (remembered) ----
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      setCollapsed(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]"));
    } catch {}
  }, []);
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  // ---- create form ----
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [workingFolder, setWorkingFolder] = useState("");
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const canCreate = name.trim() && workingFolder.trim();

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      await createProject(name.trim(), desc.trim(), { workingFolder: workingFolder.trim() });
      setName("");
      setDesc("");
      setWorkingFolder("");
      setShowForm(false);
      loadSummary();
    } finally {
      setCreating(false);
    }
  };

  // ---- derive the visible layout ----
  const activity = useCallback(
    (p: Project) => summaries[p.id]?.lastActivityAt ?? p.createdAt,
    [summaries]
  );

  const { flat, groups } = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = projects;
    if (q) {
      const matches = (p: Project) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.workingFolder ?? "").toLowerCase().includes(q) ||
        (p.createdBy?.name ?? "").toLowerCase().includes(q);
      list = projects.filter(matches);
      // Name hits first, then everything else; recent activity inside each band.
      const band = (p: Project) => (p.name.toLowerCase().includes(q) ? 0 : 1);
      const sorted = [...list].sort(
        (a, b) => band(a) - band(b) || activity(b).localeCompare(activity(a))
      );
      return { flat: sorted, groups: null };
    }
    if (projects.length < GROUP_MIN) {
      return {
        flat: [...projects].sort((a, b) => activity(b).localeCompare(activity(a))),
        groups: null,
      };
    }
    const byMonth = new Map<string, Project[]>();
    for (const p of projects) {
      const key = monthKey(p.createdAt);
      byMonth.set(key, [...(byMonth.get(key) ?? []), p]);
    }
    const groups = [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => ({
        key,
        items: items.sort((a, b) => activity(b).localeCompare(activity(a))),
      }));
    return { flat: null, groups };
  }, [projects, query, activity]);

  const renderCard = (p: Project) => {
    const s = summaries[p.id];
    const count = s?.conversationCount ?? chats.filter((c) => c.projectId === p.id).length;
    return (
      <div key={p.id} className="relative group">
        <button
          onClick={() => setDeleteTarget(p)}
          className="absolute top-3 right-3 z-10 p-2 rounded-lg text-ink-faint hover:text-red-500 hover:bg-parchment-dark opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete project"
        >
          <Trash2 size={15} />
        </button>
        <Link
          href={`/projects/${p.id}`}
          className="block rounded-xl border border-line bg-card p-5 hover:border-ink-faint transition-colors"
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${p.color}22` }}
            >
              <FolderKanban size={15} style={{ color: p.color }} />
            </div>
            <h2 className="font-medium">{p.name}</h2>
            {s?.activeNow && (
              <span className="relative flex h-2 w-2 shrink-0" title="Someone is working here now">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
          </div>
          <p className="text-sm text-ink-soft line-clamp-2 mb-3">{p.description}</p>

          {s && s.thumbs.length > 0 && p.workingFolder && (
            <div className="flex gap-1.5 mb-3">
              {s.thumbs.map((t) => (
                // eslint-disable-next-line @next/next/no-img-element -- served by our own /api/thumb resize pipeline; next/image can't optimize it further
                <img
                  key={t.sub}
                  src={`/api/thumb?root=${encodeURIComponent(p.workingFolder!)}&sub=${encodeURIComponent(
                    t.sub
                  )}&v=${t.mtimeMs}`}
                  alt=""
                  loading="lazy"
                  className="h-16 w-0 flex-1 rounded-md object-cover border border-line bg-parchment-dark"
                />
              ))}
            </div>
          )}

          {p.workingFolder && (
            <div className="flex items-center gap-1.5 text-[11px] text-ink-faint font-mono mb-1.5 truncate">
              <HardDrive size={11} className="shrink-0" />
              {p.workingFolder}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[12px] text-ink-faint">
            <MessageSquare size={11} />
            {count} conversation{count === 1 ? "" : "s"} · created {timeAgo(p.createdAt)}
          </div>
          {p.createdBy?.name && (
            <div className="flex items-center gap-1.5 text-[11px] text-ink-faint mt-1">
              <User size={11} />
              by {p.createdBy.name}
            </div>
          )}
          {s?.latest && (
            <span
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(`/conversation/${s.latest!.id}`);
              }}
              className="mt-2 flex items-center gap-1.5 text-[12px] text-accent hover:underline truncate"
              title={`Continue: ${s.latest.title}`}
            >
              <CornerDownRight size={11} className="shrink-0" />
              <span className="truncate">“{s.latest.title}”</span>
              <span className="text-ink-faint shrink-0">· {timeAgo(s.latest.updatedAt)}</span>
            </span>
          )}
        </Link>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif-display text-3xl mb-1">Projects</h1>
          <p className="text-sm text-ink-soft">
            Group conversations and artifacts around a shared context.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={15} />
          New project
        </button>
      </div>

      <div className="relative mb-8">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects — name, folder, or who made it…  ( / )"
          className="w-full rounded-lg border border-line bg-card pl-9 pr-3 py-2 text-sm outline-none focus:border-ink-faint"
        />
      </div>

      {showForm && (
        <div className="mb-8 rounded-xl border border-line bg-card p-5 space-y-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What is this project about?"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
          />
          <div>
            <p className="text-sm font-medium mb-1.5">Working folder</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm font-mono truncate text-ink-soft">
                {workingFolder || <span className="text-ink-faint">No folder chosen</span>}
              </div>
              <button
                onClick={() => setPicking(true)}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink shrink-0"
              >
                <HardDrive size={14} /> Browse
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">
              Pick a folder from the shared Drive — the assistant reads and saves files there.
            </p>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={!canCreate || creating}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg px-3.5 py-1.5 text-sm text-ink-soft hover:bg-parchment-dark"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {picking && (
        <ServerFolderPicker
          onPick={(p) => {
            setWorkingFolder(p);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      )}

      {flat && flat.length === 0 && (
        <p className="text-sm text-ink-faint text-center py-10">
          {query ? "No projects match." : "No projects yet — create the first one."}
        </p>
      )}

      {flat && flat.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{flat.map(renderCard)}</div>
      )}

      {groups &&
        groups.map(({ key, items }) => {
          const isCollapsed = collapsed.includes(key);
          return (
            <section key={key} className="mb-6">
              <button
                onClick={() => toggleGroup(key)}
                className="sticky top-0 z-10 w-full flex items-center gap-2 bg-parchment/90 backdrop-blur py-2 text-left"
              >
                {isCollapsed ? (
                  <ChevronRight size={14} className="text-ink-faint" />
                ) : (
                  <ChevronDown size={14} className="text-ink-faint" />
                )}
                <span className="text-sm font-medium">{monthLabel(key)}</span>
                <span className="text-[11px] text-ink-faint">
                  {items.length} project{items.length === 1 ? "" : "s"}
                </span>
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                  {items.map(renderCard)}
                </div>
              )}
            </section>
          );
        })}

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Delete "${deleteTarget.name}"?`}
          description={`This permanently removes the project, its ${
            chats.filter((c) => c.projectId === deleteTarget.id).length
          } conversation(s), and their artifacts. Files in the working folder on disk are NOT touched.`}
          onConfirm={() => {
            deleteProject(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
