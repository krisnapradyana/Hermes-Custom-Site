"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Plus,
  FolderKanban,
  MessageSquare,
  HardDrive,
  Trash2,
  Search,
  ArrowUpDown,
  Check,
  CalendarClock,
  Pin,
} from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo } from "@/lib/format";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { ServerFolderPicker } from "@/components/ServerFolderPicker";
import { useFocusRefresh } from "@/lib/use-focus-refresh";
import { Project, ProjectTag, PROJECT_TAGS } from "@/lib/types";

interface Thumb {
  sub: string;
  mtimeMs: number;
}
interface Summary {
  id: string;
  conversationCount: number;
  lastActivityAt: string;
  activeNow: boolean;
  thumbs: Thumb[];
}

/** Shapes served by /api/team (per-member month figures already stripped). */
interface TeamMember {
  userKey: string;
  name: string;
  active: { projectId: string; inAt: string; breakAt?: string } | null;
  todayByProject: { projectId: string; ms: number }[];
  weekByProject: { projectId: string; ms: number }[];
}
interface TeamSnap {
  members: TeamMember[];
  studioMonthMs: number;
  studioMonthByProject: Record<string, number>;
}

interface ProjTask {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  assignee?: { name: string };
}

const SORT_KEY = "hermes-proj-sort";
const PIN_KEY = "hermes-pinned-projects"; // personal, per browser — like chat pins
/** "Due soon" horizon — three working weeks reads right for studio planning. */
const SOON_DAYS = 21;

type ProjSort =
  "created-desc" | "created-asc" | "name-asc" | "name-desc" | "edited-desc" | "edited-asc";

const SORT_OPTIONS: { id: ProjSort; label: string }[] = [
  { id: "created-desc", label: "Created · newest" },
  { id: "created-asc", label: "Created · oldest" },
  { id: "edited-desc", label: "Edited · newest" },
  { id: "edited-asc", label: "Edited · oldest" },
  { id: "name-asc", label: "Name A–Z" },
  { id: "name-desc", label: "Name Z–A" },
];

type Filter =
  | "all" | "due" | "mine" | "done"
  | "flagship" | "high-budget" | "retainer" | "first-client";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "due", label: "Due soon" },
  { id: "flagship", label: "Flagship" },
  { id: "high-budget", label: "High budget" },
  { id: "retainer", label: "Retainer" },
  { id: "first-client", label: "First client" },
  { id: "mine", label: "Mine" },
  { id: "done", label: "Done" },
];

const fmtH = (ms: number): string => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m ? `${m}m` : ""}`.trim() : `${m}m`;
};

/** Whole days until a YYYY-MM-DD deadline (negative = overdue). */
const daysLeft = (deadline?: string): number | null =>
  deadline ? Math.ceil((new Date(`${deadline}T23:59:59`).getTime() - Date.now()) / 86_400_000) : null;

const dueLabel = (deadline: string): string =>
  new Date(`${deadline}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Initials for the tiny avatar chips — "Krisna Pradyana" → "KP". */
const initials = (name: string): string =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

const AV_COLORS = ["#7c3aed", "#0e9f6e", "#b45309", "#0369a1", "#be185d", "#1d4ed8", "#a3719b"];
const avColor = (key: string): string => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return AV_COLORS[Math.abs(h) % AV_COLORS.length];
};

const TAG_CHIP: Record<ProjectTag, { cls: string; label: string; title: string }> = {
  flagship: {
    cls: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    label: "★ Flagship",
    title: "Flagship — big name, publicity, portfolio; wraps through a post-mortem",
  },
  "high-budget": {
    cls: "bg-green-500/15 text-green-600 dark:text-green-400",
    label: "$",
    title: "High budget — commercial priority",
  },
  retainer: {
    cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    label: "↻",
    title: "Retainer — recurring work",
  },
  "first-client": {
    cls: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
    label: "1st",
    title: "First-time client — protect the experience",
  },
};

export default function ProjectsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const mySlackId = session?.user?.slackId;
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

  // ---- team pulse (who's on what now + studio month hours) — one fetch, 60s ----
  const [team, setTeam] = useState<TeamSnap | null>(null);
  const loadTeam = useCallback(async () => {
    try {
      const res = await fetch("/api/team", { cache: "no-store" });
      if (!res.ok) return;
      setTeam((await res.json()) as TeamSnap);
    } catch {}
  }, []);
  useEffect(() => {
    loadTeam();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadTeam();
    }, 60_000);
    return () => clearInterval(t);
  }, [loadTeam]);

  useFocusRefresh(
    useCallback(() => {
      loadProjects();
      loadSummary();
      loadTeam();
    }, [loadProjects, loadSummary, loadTeam])
  );

  // ---- search (full-width on top, / to focus) ----
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // ---- filter chips ----
  const [filter, setFilter] = useState<Filter>("all");

  // ---- sort (remembered; orders inside the LATER/DONE groups) ----
  const [sort, setSort] = useState<ProjSort>("created-desc");
  useEffect(() => {
    const saved = localStorage.getItem(SORT_KEY) as ProjSort | null;
    if (saved && SORT_OPTIONS.some((o) => o.id === saved)) setSort(saved);
  }, []);
  const changeSort = (s: ProjSort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {}
  };

  const [showArchived, setShowArchived] = useState(false);

  // ---- pinned projects (personal, stays in this browser) ----
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const s = localStorage.getItem(PIN_KEY);
      if (s) setPinnedIds(JSON.parse(s));
    } catch {}
  }, []);
  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // ---- create form ----
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [workingFolder, setWorkingFolder] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [newTags, setNewTags] = useState<ProjectTag[]>([]);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  // Two ways in: BRAND NEW creates the folder + standard template inside a
  // chosen location; EXISTING points at a folder that's already on the Drive.
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [folderName, setFolderName] = useState("");
  const [parentFolder, setParentFolder] = useState("");
  // Schedule is required — the timeline is only as good as its dates.
  const canCreate =
    name.trim() &&
    startDate &&
    deadline &&
    (mode === "new" ? folderName.trim() && parentFolder.trim() : workingFolder.trim());

  const resetForm = () => {
    setName("");
    setDesc("");
    setWorkingFolder("");
    setFolderName("");
    setParentFolder("");
    setStartDate("");
    setDeadline("");
    setNewTags([]);
    setCreateError("");
  };

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      await createProject(name.trim(), desc.trim(), {
        ...(mode === "new"
          ? { newFolder: { parent: parentFolder.trim(), name: folderName.trim() } }
          : { workingFolder: workingFolder.trim() }),
        startDate: startDate || undefined,
        deadline: deadline || undefined,
        tags: newTags.length > 0 ? newTags : undefined,
      });
      resetForm();
      setShowForm(false);
      loadSummary();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setCreating(false);
    }
  };

  const activity = useCallback(
    (p: Project) => summaries[p.id]?.lastActivityAt ?? p.createdAt,
    [summaries]
  );

  // ---- per-project helpers backed by the team snapshot ----
  const monthMsOf = useCallback(
    (id: string) => team?.studioMonthByProject?.[id] ?? 0,
    [team]
  );
  const crew = useCallback(
    (id: string): TeamMember[] =>
      (team?.members ?? []).filter(
        (m) =>
          m.active?.projectId === id ||
          (m.weekByProject ?? []).some((w) => w.projectId === id && w.ms > 0)
      ),
    [team]
  );
  const isMine = useCallback(
    (p: Project): boolean => {
      if (!mySlackId) return false;
      if (p.createdBy?.slackId === mySlackId) return true;
      const me = (team?.members ?? []).find((m) => m.userKey === mySlackId);
      if (!me) return false;
      return (
        me.active?.projectId === p.id ||
        (me.weekByProject ?? []).some((w) => w.projectId === p.id && w.ms > 0)
      );
    },
    [mySlackId, team]
  );

  const matchesFilter = useCallback(
    (p: Project, f: Filter): boolean => {
      switch (f) {
        case "all":
          return true;
        case "due": {
          const d = daysLeft(p.deadline);
          return !p.doneAt && d !== null && d <= SOON_DAYS;
        }
        case "mine":
          return isMine(p);
        case "done":
          return !!p.doneAt;
        default:
          return (p.tags ?? []).includes(f);
      }
    },
    [isMine]
  );

  // ---- the visible, grouped list ----
  const q = query.trim().toLowerCase();
  const { soon, later, done, visibleIds, counts } = useMemo(() => {
    const compare = (a: Project, b: Project): number => {
      switch (sort) {
        case "name-asc":
          return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        case "name-desc":
          return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
        case "edited-desc":
          return activity(b).localeCompare(activity(a));
        case "edited-asc":
          return activity(a).localeCompare(activity(b));
        case "created-asc":
          return a.createdAt.localeCompare(b.createdAt);
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    };
    const matchesQuery = (p: Project) =>
      !q ||
      (p.name ?? "").toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      (p.workingFolder ?? "").toLowerCase().includes(q) ||
      (p.createdBy?.name ?? "").toLowerCase().includes(q);

    // Archived projects hide from the default list (searches still find them).
    const pool = projects.filter((p) => (showArchived || q ? true : !p.archived));
    const searched = pool.filter(matchesQuery);
    const counts = Object.fromEntries(
      FILTERS.map((f) => [f.id, searched.filter((p) => matchesFilter(p, f.id)).length])
    ) as Record<Filter, number>;
    const base = searched.filter((p) => matchesFilter(p, filter));

    const pinFirst = (a: Project, b: Project) =>
      (pinnedIds.includes(b.id) ? 1 : 0) - (pinnedIds.includes(a.id) ? 1 : 0);

    const soon = base
      .filter((p) => !p.doneAt && daysLeft(p.deadline) !== null && daysLeft(p.deadline)! <= SOON_DAYS)
      .sort((a, b) => pinFirst(a, b) || daysLeft(a.deadline)! - daysLeft(b.deadline)!);
    const soonIds = new Set(soon.map((p) => p.id));
    const later = base
      .filter((p) => !p.doneAt && !soonIds.has(p.id))
      .sort((a, b) => pinFirst(a, b) || compare(a, b));
    const done = base.filter((p) => !!p.doneAt).sort(compare);
    return {
      soon,
      later,
      done,
      visibleIds: [...soon, ...later, ...done].map((p) => p.id),
      counts,
    };
  }, [projects, q, filter, sort, activity, matchesFilter, pinnedIds, showArchived]);

  // ---- selection (drives the cockpit pane) ----
  const [selId, setSelId] = useState<string | null>(null);
  useEffect(() => {
    if (visibleIds.length === 0) {
      if (selId !== null) setSelId(null);
    } else if (!selId || !visibleIds.includes(selId)) {
      setSelId(visibleIds[0]);
    }
  }, [visibleIds, selId]);
  const selected = projects.find((p) => p.id === selId) ?? null;

  // Hover selects, slightly debounced so skimming the list doesn't thrash.
  const hoverT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverSelect = (id: string) => {
    if (hoverT.current) clearTimeout(hoverT.current);
    hoverT.current = setTimeout(() => setSelId(id), 120);
  };

  // ---- lazy per-project tasks for the cockpit (60s cache) ----
  const taskCache = useRef(new Map<string, { at: number; tasks: ProjTask[] }>());
  const [selTasks, setSelTasks] = useState<ProjTask[] | null>(null);
  useEffect(() => {
    if (!selId) {
      setSelTasks(null);
      return;
    }
    const hit = taskCache.current.get(selId);
    if (hit && Date.now() - hit.at < 60_000) {
      setSelTasks(hit.tasks);
      return;
    }
    setSelTasks(hit?.tasks ?? null); // show stale instantly, refresh behind
    let gone = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${selId}/tasks`, { cache: "no-store" });
        if (!res.ok) return;
        const { tasks } = (await res.json()) as { tasks: ProjTask[] };
        taskCache.current.set(selId, { at: Date.now(), tasks });
        if (!gone) setSelTasks(tasks);
      } catch {}
    })();
    return () => {
      gone = true;
    };
  }, [selId]);

  // ---- keyboard: / search · ↑↓ move · Enter open · P pin ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || visibleIds.length === 0) return;
      const i = selId ? visibleIds.indexOf(selId) : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelId(visibleIds[Math.min(visibleIds.length - 1, i + 1)]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelId(visibleIds[Math.max(0, i - 1)]);
      } else if (e.key === "Enter" && selId) {
        router.push(`/projects/${selId}`);
      } else if (e.key.toLowerCase() === "p" && selId) {
        togglePin(selId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleIds, selId, router, togglePin]);

  // ---- one project row (command list) ----
  const maxMonthMs = useMemo(
    () => Math.max(1, ...projects.map((p) => monthMsOf(p.id))),
    [projects, monthMsOf]
  );

  const renderRow = (p: Project) => {
    const isSel = p.id === selId;
    const isPinned = pinnedIds.includes(p.id);
    const d = daysLeft(p.deadline);
    const ms = monthMsOf(p.id);
    const onIt = crew(p.id);
    const live = onIt.some((m) => m.active?.projectId === p.id && !m.active.breakAt);
    return (
      <div
        key={p.id}
        onMouseEnter={() => hoverSelect(p.id)}
        onClick={() => {
          // Below lg there is no cockpit pane — a tap goes straight in.
          if (window.innerWidth < 1024) router.push(`/projects/${p.id}`);
          else setSelId(p.id);
        }}
        onDoubleClick={() => router.push(`/projects/${p.id}`)}
        className={`group flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
          isSel
            ? "border-accent/60 bg-accent-soft"
            : "border-line bg-card hover:border-ink-faint"
        } ${p.archived ? "opacity-55" : p.doneAt ? "opacity-70" : ""}`}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded"
          style={{ backgroundColor: p.color }}
          aria-hidden
        />
        <span
          className={`min-w-0 flex-1 truncate text-[13.5px] ${isSel ? "font-semibold" : "font-medium"}`}
        >
          {isPinned && <Pin size={11} className="mr-1 inline -mt-0.5 text-amber-500" fill="currentColor" />}
          {p.name}
          {live && (
            <span className="relative ml-1.5 inline-flex h-2 w-2" title="Someone is working here now">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
          )}
        </span>
        {(p.tags ?? []).map((t) => (
          <span
            key={t}
            title={TAG_CHIP[t].title}
            className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] sm:inline ${TAG_CHIP[t].cls}`}
          >
            {TAG_CHIP[t].label}
          </span>
        ))}
        {onIt.length > 0 && (
          <span className="hidden shrink-0 md:flex">
            {onIt.slice(0, 3).map((m, i) => (
              <span
                key={m.userKey}
                title={m.name}
                className={`flex h-5 w-5 items-center justify-center rounded-full border border-card text-[8.5px] font-bold text-white ${i > 0 ? "-ml-1.5" : ""}`}
                style={{ backgroundColor: avColor(m.userKey) }}
              >
                {initials(m.name)}
              </span>
            ))}
            {onIt.length > 3 && (
              <span className="-ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-card bg-parchment-dark text-[8.5px] font-bold text-ink-soft">
                +{onIt.length - 3}
              </span>
            )}
          </span>
        )}
        {ms > 0 && !p.doneAt && (
          <span className="hidden w-16 shrink-0 lg:block" title={`${fmtH(ms)} studio time this month`}>
            <span className="block h-1 overflow-hidden rounded bg-parchment-dark">
              <span
                className="block h-full rounded"
                style={{ width: `${Math.max(6, Math.round((ms / maxMonthMs) * 100))}%`, backgroundColor: p.color }}
              />
            </span>
          </span>
        )}
        {p.doneAt ? (
          <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10.5px] font-medium text-green-600 dark:text-green-400">
            Done
          </span>
        ) : d !== null ? (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${
              d < 0
                ? "border-red-500/50 bg-red-500/10 text-red-500"
                : d <= SOON_DAYS
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-line text-ink-soft"
            }`}
          >
            {d < 0 ? `overdue ${-d}d` : `${dueLabel(p.deadline!)} · ${d}d`}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-faint">
            no date
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePin(p.id);
          }}
          className={`shrink-0 rounded-md p-1 transition-opacity ${
            isPinned
              ? "text-amber-500"
              : "text-ink-faint opacity-0 hover:text-amber-500 group-hover:opacity-100"
          }`}
          title={isPinned ? "Unpin" : "Pin to the top of its group (P)"}
        >
          <Pin size={13} fill={isPinned ? "currentColor" : "none"} />
        </button>
      </div>
    );
  };

  const groupHeader = (label: string, n: number, cls: string) => (
    <p className={`mb-1.5 mt-5 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] first:mt-0 ${cls}`}>
      {label} — {n}
    </p>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-10">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="mb-1 font-serif-display text-3xl">Projects</h1>
          <p className="text-sm text-ink-soft">
            {projects.filter((p) => !p.archived && !p.doneAt).length} active ·{" "}
            {projects.filter((p) => !!p.doneAt).length} done
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <Plus size={15} />
          New project
        </button>
      </div>

      {/* Search stays the full-width front door (team feedback). */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Search projects — name, folder, or who made it…  ( / )"
            className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-ink-faint"
          />
        </div>
        <ProjectSortMenu value={sort} onChange={changeSort} />
      </div>

      {/* Filter chips with live counts — month groups' replacement. */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(on ? "all" : f.id)}
              className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                on
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-soft hover:border-ink-faint"
              }`}
            >
              {f.label} · {counts[f.id] ?? 0}
            </button>
          );
        })}
      </div>

      {showForm && (
        <div className="mb-8 space-y-3 rounded-xl border border-line bg-card p-5">
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
          {/* Mode: brand-new (creates folder + template) vs existing folder */}
          <div className="flex w-fit overflow-hidden rounded-lg border border-line">
            {(
              [
                ["new", "Brand new project"],
                ["existing", "Existing project"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3.5 py-1.5 text-[13px] transition-colors ${
                  mode === m ? "bg-accent font-medium text-white" : "text-ink-soft hover:bg-parchment-dark"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "new" ? (
            <>
              <div>
                <p className="mb-1.5 text-sm font-medium">Folder name</p>
                <input
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="e.g. 2026011_CLIENT_Project Name"
                  className="w-full rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-ink-faint"
                />
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium">Location</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 truncate rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm text-ink-soft">
                    {parentFolder || (
                      <span className="text-ink-faint">
                        Where to create it — e.g. /gdrive/SUPERPIXEL/2026 PROJECTS
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setPicking(true)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink"
                  >
                    <HardDrive size={14} /> Browse
                  </button>
                </div>
                {parentFolder && folderName.trim() && (
                  <p className="mt-1.5 truncate font-mono text-[12px] text-accent">
                    → {parentFolder}/{folderName.trim()}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-ink-faint">
                  The folder is created with the standard template inside: Assets, Audio, Comments,
                  FINAL OUTPUT, From Client, INPUT, Preview, Project Brief, REF, Timeline, Working
                  file.
                </p>
              </div>
            </>
          ) : (
            <div>
              <p className="mb-1.5 text-sm font-medium">Working folder</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 truncate rounded-lg border border-line bg-transparent px-3 py-2 font-mono text-sm text-ink-soft">
                  {workingFolder || <span className="text-ink-faint">No folder chosen</span>}
                </div>
                <button
                  onClick={() => setPicking(true)}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink"
                >
                  <HardDrive size={14} /> Browse
                </button>
              </div>
              <p className="mt-1 text-[11px] text-ink-faint">
                Pick a folder that already exists on the shared Drive — no template folders are
                created.
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="mb-1.5 block text-sm font-medium">Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
              />
            </label>
            <label className="flex-1">
              <span className="mb-1.5 block text-sm font-medium">Deadline</span>
              <input
                type="date"
                value={deadline}
                min={startDate || undefined}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
              />
            </label>
          </div>
          {/* Classification tags (leadership request) — any subset. */}
          <div>
            <span className="mb-1.5 block text-sm font-medium">
              Project type <span className="font-normal text-ink-faint">— pick any that apply</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_TAGS.map((t) => {
                const on = newTags.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setNewTags((cur) => (on ? cur.filter((x) => x !== t.id) : [...cur, t.id]))}
                    className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                      on
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line text-ink-soft hover:border-ink-faint"
                    }`}
                  >
                    {t.label}
                    {on ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">
              Flagship projects wrap through a post-mortem form when marked done.
            </p>
          </div>
          {/* Permanence warning — the folder choice is forever. */}
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12.5px] text-amber-600 dark:text-amber-400">
            ⚠ The working folder is permanent. Once the project is created it cannot be moved or
            re-pointed — double-check the {mode === "new" ? "name and location" : "folder"} before
            creating.
          </div>

          {createError && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500">
              {createError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCreate}
              disabled={!canCreate || creating}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {creating ? (mode === "new" ? "Creating folders…" : "Creating…") : "Create"}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setCreateError("");
              }}
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
            // New mode picks the LOCATION (parent); existing picks the folder itself.
            if (mode === "new") setParentFolder(p);
            else setWorkingFolder(p);
            setPicking(false);
          }}
          onCancel={() => setPicking(false)}
        />
      )}

      <div className="flex items-start gap-5">
        {/* LEFT — the command list, grouped by urgency. */}
        <div className="min-w-0 flex-1 space-y-1">
          {visibleIds.length === 0 && (
            <p className="py-10 text-center text-sm text-ink-faint">
              {q || filter !== "all" ? "No projects match." : "No projects yet — create the first one."}
            </p>
          )}
          {soon.length > 0 && (
            <>
              {groupHeader("⚑ Due soon", soon.length, "text-red-500")}
              {soon.map(renderRow)}
            </>
          )}
          {later.length > 0 && (
            <>
              {groupHeader("Later", later.length, "text-ink-faint")}
              {later.map(renderRow)}
            </>
          )}
          {done.length > 0 && (
            <>
              {groupHeader("Done", done.length, "text-green-600 dark:text-green-400")}
              {done.map(renderRow)}
            </>
          )}

          {/* Archived live here, out of the way but never lost. */}
          {!q && projects.some((p) => p.archived) && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="w-full py-3 text-center text-[12px] text-ink-faint transition-colors hover:text-ink"
            >
              {showArchived
                ? "Hide archived projects"
                : `Show archived projects · ${projects.filter((p) => p.archived).length}`}
            </button>
          )}
          <p className="hidden px-1 pt-2 text-[10.5px] text-ink-faint lg:block">
            ↑↓ navigate · Enter open · double-click open · P pin · / search
          </p>
        </div>

        {/* RIGHT — the cockpit pane (desktop only; rows navigate directly below
            lg). FIXED width: a content-sized pane resized on every hover and
            made the whole layout wobble (field video). */}
        <div className="sticky top-6 hidden w-[400px] shrink-0 lg:block xl:w-[460px]">
          {selected ? (
            <Cockpit
              key={selected.id}
              p={selected}
              summary={summaries[selected.id]}
              chatCount={
                summaries[selected.id]?.conversationCount ??
                chats.filter((c) => c.projectId === selected.id).length
              }
              tasks={selTasks}
              monthMs={monthMsOf(selected.id)}
              studioMonthMs={team?.studioMonthMs ?? 0}
              members={team?.members ?? []}
              pinned={pinnedIds.includes(selected.id)}
              onPin={() => togglePin(selected.id)}
              onDelete={() => setDeleteTarget(selected)}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-faint">
              Hover a project to preview it here.
            </div>
          )}
        </div>
      </div>

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

/** The live preview pane: everything a lead asks about a project, one glance. */
function Cockpit({
  p,
  summary,
  chatCount,
  tasks,
  monthMs,
  studioMonthMs,
  members,
  pinned,
  onPin,
  onDelete,
}: {
  p: Project;
  summary?: Summary;
  chatCount: number;
  tasks: ProjTask[] | null;
  monthMs: number;
  studioMonthMs: number;
  members: TeamMember[];
  pinned: boolean;
  onPin: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const d = daysLeft(p.deadline);
  const doneTasks = (tasks ?? []).filter((t) => t.status === "done").length;
  const totalTasks = (tasks ?? []).length;
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const share = studioMonthMs > 0 ? Math.round((monthMs / studioMonthMs) * 100) : 0;
  const onIt = members.filter((m) => m.active?.projectId === p.id);
  const latest = (tasks ?? [])
    .filter((t) => t.status !== "todo")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 2);
  const todayOf = (m: TeamMember) =>
    (m.todayByProject ?? []).find((w) => w.projectId === p.id)?.ms ?? 0;

  const borderCls = p.doneAt
    ? "border-green-500/35"
    : d !== null && d <= SOON_DAYS
      ? "border-amber-500/40"
      : "border-line";

  return (
    <div className={`glass-panel rounded-2xl border p-5 ${borderCls}`}>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded" style={{ backgroundColor: p.color }} aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{p.name}</h2>
        {p.doneAt ? (
          <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10.5px] font-medium text-green-600 dark:text-green-400">
            Done
          </span>
        ) : d !== null ? (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${
              d < 0
                ? "border-red-500/50 bg-red-500/10 text-red-500"
                : d <= SOON_DAYS
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-line text-ink-soft"
            }`}
          >
            {d < 0 ? `overdue ${-d}d` : `${d}d left`}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[12.5px] text-ink-soft">{p.description || "No description."}</p>
      <p className="mt-1 text-[11px] text-ink-faint">
        {p.createdBy?.name ? `by ${p.createdBy.name} · ` : ""}created {timeAgo(p.createdAt)}
        {(p.tags ?? []).map((t) => (
          <span key={t} className={`ml-1.5 rounded-full px-1.5 py-px text-[9.5px] ${TAG_CHIP[t].cls}`}>
            {TAG_CHIP[t].label}
          </span>
        ))}
      </p>

      {summary && summary.thumbs.length > 0 && p.workingFolder && (
        <div className="mt-3 flex gap-1.5">
          {summary.thumbs.map((t) => (
            // eslint-disable-next-line @next/next/no-img-element -- served by our own /api/thumb resize pipeline; next/image can't optimize it further
            <img
              key={t.sub}
              src={`/api/thumb?root=${encodeURIComponent(p.workingFolder!)}&sub=${encodeURIComponent(t.sub)}&v=${t.mtimeMs}`}
              alt=""
              loading="lazy"
              className="h-14 w-0 flex-1 rounded-md border border-line bg-parchment-dark object-cover"
            />
          ))}
        </div>
      )}

      <p className="mb-1 mt-4 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
        Tasks {tasks === null ? "…" : `${doneTasks}/${totalTasks}`}
      </p>
      <div className="h-1.5 overflow-hidden rounded bg-parchment-dark">
        <span
          className="block h-full rounded transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: p.color }}
        />
      </div>

      <div className="mt-4 flex items-center gap-4">
        <svg viewBox="0 0 42 42" className="h-[84px] w-[84px] shrink-0">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="currentColor" strokeWidth="5" className="text-parchment-dark" />
          {monthMs > 0 && (
            <circle
              cx="21"
              cy="21"
              r="15.9"
              fill="none"
              stroke={p.color}
              strokeWidth="5"
              strokeDasharray={`${Math.max(2, share)} ${100 - Math.max(2, share)}`}
              strokeDashoffset="25"
              strokeLinecap="round"
            />
          )}
          <text
            x="21"
            y="20"
            textAnchor="middle"
            fill="currentColor"
            className="text-ink text-[7.5px] font-bold"
          >
            {fmtH(monthMs)}
          </text>
          <text
            x="21"
            y="27"
            textAnchor="middle"
            fill="currentColor"
            className="text-ink-faint text-[4.2px]"
          >
            this month
          </text>
        </svg>
        <div className="min-w-0">
          <p className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
            On it now
          </p>
          {onIt.length === 0 && (
            <p className="text-[12px] text-ink-faint">Nobody clocked in on this right now.</p>
          )}
          {onIt.map((m) => (
            <p key={m.userKey} className="mb-0.5 flex items-center gap-1.5 text-[12px] text-ink-soft">
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[8.5px] font-bold text-white"
                style={{ backgroundColor: avColor(m.userKey) }}
              >
                {initials(m.name)}
              </span>
              <span className="truncate">
                {m.name} · {m.active?.breakAt ? "on break" : `${fmtH(todayOf(m))} today`}
              </span>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.active?.breakAt ? "bg-amber-500" : "animate-pulse bg-green-500"}`}
              />
            </p>
          ))}
          {monthMs > 0 && studioMonthMs > 0 && (
            <p className="mt-1 text-[10.5px] text-ink-faint">{share}% of studio time this month</p>
          )}
        </div>
      </div>

      <p className="mb-1 mt-4 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
        Latest
      </p>
      {latest.length === 0 ? (
        <p className="text-[11.5px] text-ink-faint">No task activity yet.</p>
      ) : (
        latest.map((t) => (
          <p key={t.id} className="truncate text-[11.5px] leading-relaxed text-ink-soft">
            {t.status === "done" ? "✔" : "·"} “{t.title}” → {t.status}
            {t.assignee?.name ? ` · ${t.assignee.name}` : ""} · {timeAgo(t.updatedAt)}
          </p>
        ))
      )}
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
        <MessageSquare size={10.5} /> {chatCount} conversation{chatCount === 1 ? "" : "s"}
        {p.deadline && (
          <>
            <CalendarClock size={10.5} className="ml-2" /> due {dueLabel(p.deadline)}
          </>
        )}
      </p>
      {p.workingFolder && (
        <p className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-ink-faint">
          <HardDrive size={10.5} className="shrink-0" />
          <span className="min-w-0 truncate">{p.workingFolder}</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => router.push(`/projects/${p.id}`)}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-accent-hover"
        >
          Open project →
        </button>
        <button
          onClick={() => router.push(`/projects/${p.id}/tasks`)}
          className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:border-ink-faint hover:text-ink"
        >
          <FolderKanban size={12} className="-mt-0.5 mr-1 inline" />
          Board
        </button>
        {!p.doneAt && p.tags?.includes("flagship") && (
          <button
            onClick={() => router.push(`/projects/${p.id}/wrap`)}
            className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:border-ink-faint hover:text-ink"
          >
            Wrap up
          </button>
        )}
        <span className="flex-1" />
        <button
          onClick={onPin}
          className={`rounded-lg p-1.5 ${pinned ? "text-amber-500" : "text-ink-faint hover:text-amber-500"}`}
          title={pinned ? "Unpin" : "Pin"}
        >
          <Pin size={14} fill={pinned ? "currentColor" : "none"} />
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg p-1.5 text-ink-faint hover:text-red-500"
          title="Delete project"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function ProjectSortMenu({
  value,
  onChange,
}: {
  value: ProjSort;
  onChange: (s: ProjSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = SORT_OPTIONS.find((o) => o.id === value) ?? SORT_OPTIONS[0];

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
          open ? "border-ink-faint text-ink" : "border-line text-ink-soft hover:border-ink-faint hover:text-ink"
        }`}
        title={`Sort (Later/Done groups): ${current.label}`}
      >
        <ArrowUpDown size={13} />
        <span className="hidden sm:inline">{current.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-line bg-card p-1.5 shadow-lg">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-parchment-dark"
            >
              <span>{o.label}</span>
              {o.id === value && <Check size={13} className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
