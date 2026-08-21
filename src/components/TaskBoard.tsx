"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Plus,
  Trash2,
  CornerDownRight,
  Search,
  X,
  Archive,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Diamond,
} from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";

/**
 * Tasks tab of a project — assign work, iterate smoothly.
 * Lifecycle: todo → doing → review → revision → done. Anyone creates;
 * only the assignee or creator changes status (server-enforced; the UI
 * simply shows controls to everyone and surfaces the server's answer).
 */

type TaskStatus = "todo" | "doing" | "review" | "revision" | "done";

interface Person {
  key: string;
  name: string;
}

export interface Task {
  id: string;
  projectId: string;
  kind?: "task" | "milestone";
  title: string;
  note?: string;
  phase?: string;
  assignee?: Person;
  status: TaskStatus;
  statusNote?: string;
  startDate?: string;
  dueDate?: string;
  createdBy: Person;
  createdAt: string;
  updatedAt: string;
}

const STATUSES: { id: TaskStatus; label: string; cls: string }[] = [
  { id: "todo", label: "To do", cls: "bg-parchment-dark text-ink-soft" },
  { id: "doing", label: "Doing", cls: "bg-accent-soft text-accent" },
  { id: "review", label: "Review", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  { id: "revision", label: "Revision", cls: "bg-red-500/10 text-red-500" },
  { id: "done", label: "Done", cls: "bg-green-500/15 text-green-600 dark:text-green-400" },
];

const PHASES = [
  "Styleframes",
  "Storyboard",
  "Animatic",
  "Animation",
  "Render",
  "Revisions",
  "On-site",
  "Other",
];

export function TaskBoard({
  projectId,
  onTasks,
}: {
  projectId: string;
  /** Lets the page above (timeline) see the same task list. */
  onTasks?: (tasks: Task[]) => void;
}) {
  const { data: session } = useSession();
  const slackId = session?.user?.slackId;
  const sessionName = session?.user?.name;
  const me: Person = useMemo(
    () =>
      slackId
        ? { key: slackId, name: sessionName ?? "Member" }
        : { key: "local", name: "Local User" },
    [slackId, sessionName]
  );

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [members, setMembers] = useState<Person[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await api.get<{ tasks: Task[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/tasks`
    );
    if (res.ok) {
      setTasks(res.data.tasks);
      onTasks?.(res.data.tasks);
    } else setError(res.error);
  }, [projectId, onTasks]);

  useEffect(() => {
    load();
    // Assignee picker: everyone the clock has ever seen (best-available list).
    api
      .get<{ members: { userKey: string; name: string }[] }>("/api/team")
      .then((res) => {
        if (res.ok) setMembers(res.data.members.map((m) => ({ key: m.userKey, name: m.name })));
      })
      .catch(() => {});
  }, [load, projectId]);

  // People selectable as assignee: clock members + me + anyone already on a task.
  const people = useMemo(() => {
    const map = new Map<string, Person>();
    if (me) map.set(me.key, me);
    for (const m of members) map.set(m.key, m);
    for (const t of tasks ?? []) {
      if (t.assignee) map.set(t.assignee.key, t.assignee);
      map.set(t.createdBy.key, t.createdBy);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [members, tasks, me]);

  // ---- create form ----
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState("");
  const [assigneeKey, setAssigneeKey] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [kind, setKind] = useState<"task" | "milestone">("task");
  const [creating, setCreating] = useState(false);
  const canCreate = title.trim() && (kind === "task" || dueDate);

  const create = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    const assignee = people.find((p) => p.key === assigneeKey);
    const res = await api.post<{ task: Task }>(
      `/api/projects/${encodeURIComponent(projectId)}/tasks`,
      {
        title: title.trim(),
        note: note.trim() || undefined,
        phase: kind === "task" ? phase || undefined : undefined,
        assignee: kind === "task" ? assignee : undefined,
        startDate: kind === "task" ? startDate || undefined : undefined,
        dueDate: dueDate || undefined,
        kind,
      }
    );
    if (res.ok) {
      setTitle("");
      setNote("");
      setPhase("");
      setStartDate("");
      setDueDate("");
      load();
    } else setError(res.error);
    setCreating(false);
  };

  // ---- status change (revision asks for feedback inline) ----
  const [revisionFor, setRevisionFor] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");

  const setStatus = async (t: Task, status: TaskStatus, statusNote?: string) => {
    const res = await api.patch<{ task: Task }>(
      `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(t.id)}`,
      { status, statusNote }
    );
    if (res.ok) {
      setError("");
      load();
    } else setError(res.error);
  };

  const remove = async (t: Task) => {
    const res = await api.del(
      `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(t.id)}`
    );
    if (res.ok) load();
    else setError((res as { error: string }).error);
  };

  // ---- filters: search + Mine + Overdue + phase ----
  const [q, setQ] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [phaseFilter, setPhaseFilter] = useState("");
  const anyFilter = !!(q.trim() || mineOnly || overdueOnly || phaseFilter);
  const today = new Date().toISOString().slice(0, 10);
  const matches = (t: Task) => {
    if (mineOnly && t.assignee?.key !== me.key) return false;
    if (overdueOnly && !(t.status !== "done" && t.dueDate && t.dueDate < today)) return false;
    if (phaseFilter && (t.phase ?? "") !== phaseFilter) return false;
    const s = q.trim().toLowerCase();
    if (s) {
      return (
        t.title.toLowerCase().includes(s) ||
        (t.note ?? "").toLowerCase().includes(s) ||
        (t.assignee?.name ?? "").toLowerCase().includes(s)
      );
    }
    return true;
  };

  // ---- archive (swept done-tasks) — lazy-loaded, searchable, restorable ----
  const [archived, setArchived] = useState<Task[] | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const toggleArchive = async () => {
    setShowArchive((v) => !v);
    if (!archived) {
      const res = await api.get<{ tasks: Task[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/tasks/archive`
      );
      if (res.ok) setArchived(res.data.tasks);
      else setError(res.error);
    }
  };

  const restore = async (t: Task) => {
    if (restoring) return;
    setRestoring(t.id);
    const res = await api.post(
      `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(t.id)}/restore`,
      {}
    );
    if (res.ok) {
      setArchived((a) => a?.filter((x) => x.id !== t.id) ?? null);
      load();
    } else setError((res as { error: string }).error);
    setRestoring(null);
  };

  // Milestones live in their own chronological strip (the project skeleton),
  // never inside the status sections — those are for work in motion.
  const milestones = (tasks ?? [])
    .filter((t) => t.kind === "milestone")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  const grouped = STATUSES.map((s) => ({
    ...s,
    items: (tasks ?? []).filter(
      (t) => t.kind !== "milestone" && t.status === s.id && matches(t)
    ),
  }));
  const visibleCount = grouped.reduce((n, g) => n + g.items.length, 0);
  const archivedShown = (archived ?? []).filter(matches);

  return (
    <div className="mb-10">
      {/* Milestones strip — the project's skeleton, chronological, at a glance. */}
      {milestones.length > 0 && (
        <div className="mb-4 rounded-xl border border-line bg-card px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-2">
            <Diamond size={11} className="text-accent" fill="currentColor" />
            Milestones · {milestones.length}
          </h3>
          <div className="space-y-1">
            {milestones.map((m) => {
              const overdue = m.status !== "done" && !!m.dueDate && m.dueDate < today;
              const done = m.status === "done";
              return (
                <div key={m.id} className="flex items-center gap-2.5 group py-0.5">
                  <button
                    onClick={() => setStatus(m, done ? "todo" : "done")}
                    title={done ? "Mark as not done" : "Mark as done"}
                    className="shrink-0 p-0.5"
                  >
                    <Diamond
                      size={13}
                      className={done ? "text-green-500" : "text-accent"}
                      fill={done ? "currentColor" : "none"}
                    />
                  </button>
                  <span
                    className={`flex-1 min-w-0 text-[13.5px] truncate ${
                      done ? "line-through text-ink-faint" : ""
                    }`}
                  >
                    {m.title}
                  </span>
                  <span
                    className={`text-[12px] tabular-nums shrink-0 ${
                      overdue ? "text-red-500 font-medium" : "text-ink-faint"
                    }`}
                  >
                    {overdue ? "⚠ " : ""}
                    {m.dueDate
                      ? new Date(`${m.dueDate}T00:00:00`).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })
                      : "no date"}
                  </span>
                  <button
                    onClick={() => remove(m)}
                    className="p-1 rounded text-ink-faint hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Delete milestone"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[12px] text-ink-faint mb-3">
        Assign work and track iteration — to do → doing → review → revision → done. Only the
        assignee or the creator can move a task.
      </p>

      {/* New task / milestone */}
      <div className="mb-5 rounded-xl border border-line bg-card p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "task" | "milestone")}
            className="rounded-lg border border-line bg-card px-2 py-2 text-[13px] text-ink-soft outline-none"
            title="A task is a bar on the timeline; a milestone is a single-date marker"
          >
            <option value="task">Task</option>
            <option value="milestone">Milestone</option>
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder={
              kind === "task"
                ? "New task — e.g. Styleframes v2 for scene 3"
                : "Milestone — e.g. Client review round 1"
            }
            className="flex-1 min-w-[12rem] rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
          />
          {kind === "task" && (
            <>
              <select
                value={phase}
                onChange={(e) => setPhase(e.target.value)}
                className="rounded-lg border border-line bg-card px-2 py-2 text-[13px] text-ink-soft outline-none"
              >
                <option value="">Phase…</option>
                {PHASES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                value={assigneeKey}
                onChange={(e) => setAssigneeKey(e.target.value)}
                className="rounded-lg border border-line bg-card px-2 py-2 text-[13px] text-ink-soft outline-none max-w-[10rem]"
              >
                <option value="">Assign to…</option>
                {people.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Description — what exactly is needed? (optional)"
            rows={2}
            className="flex-1 min-w-[14rem] rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] outline-none focus:border-ink-faint resize-y"
          />
          <div className="flex flex-col gap-1.5">
            {kind === "task" && (
              <label className="flex items-center gap-2 text-[11px] text-ink-faint">
                Start
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border border-line bg-card px-2 py-1 text-[12px] text-ink-soft outline-none"
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-[11px] text-ink-faint">
              {kind === "task" ? "Due" : "Date"}
              <input
                type="date"
                value={dueDate}
                min={startDate || undefined}
                onChange={(e) => setDueDate(e.target.value)}
                className="rounded-lg border border-line bg-card px-2 py-1 text-[12px] text-ink-soft outline-none"
              />
            </label>
          </div>
          <button
            onClick={create}
            disabled={!canCreate || creating}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-40 self-end"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
      </div>

      {/* Filters — keep a months-old board one search away from small. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[11rem]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tasks — title, description, assignee…"
            className="w-full rounded-lg border border-line bg-card pl-8 pr-8 py-1.5 text-[13px] outline-none focus:border-ink-faint placeholder:text-ink-faint"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-ink-faint hover:text-ink"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <button
          onClick={() => setMineOnly((v) => !v)}
          className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
            mineOnly
              ? "border-accent bg-accent-soft text-accent font-medium"
              : "border-line text-ink-soft hover:border-ink-faint"
          }`}
        >
          Mine
        </button>
        <button
          onClick={() => setOverdueOnly((v) => !v)}
          className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
            overdueOnly
              ? "border-red-500/60 bg-red-500/10 text-red-500 font-medium"
              : "border-line text-ink-soft hover:border-ink-faint"
          }`}
        >
          Overdue
        </button>
        <select
          value={phaseFilter}
          onChange={(e) => setPhaseFilter(e.target.value)}
          className={`rounded-full border px-2.5 py-1 text-[12px] outline-none ${
            phaseFilter ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink-soft"
          }`}
        >
          <option value="">All phases</option>
          {PHASES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        {anyFilter && (
          <button
            onClick={() => {
              setQ("");
              setMineOnly(false);
              setOverdueOnly(false);
              setPhaseFilter("");
            }}
            className="text-[12px] text-ink-faint hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}
      {!tasks && !error && <p className="text-sm text-ink-faint">Loading…</p>}
      {tasks && tasks.filter((t) => t.kind !== "milestone").length === 0 && (
        <p className="text-sm text-ink-faint">No tasks yet — add the first one above.</p>
      )}
      {tasks && tasks.length > 0 && anyFilter && visibleCount === 0 && (
        <p className="text-sm text-ink-faint">
          No open tasks match — check the archive below or clear the filters.
        </p>
      )}

      {grouped.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.id} className="mb-5">
              <h3 className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-ink-faint mb-2">
                <span className={`rounded-full px-2 py-0.5 ${g.cls}`}>{g.label}</span>
                {g.items.length}
              </h3>
              <div className="space-y-2">
                {g.items.map((t) => (
                  <div key={t.id} className="rounded-xl border border-line bg-card px-4 py-3 group">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {t.kind === "milestone" && (
                            <span className="mr-1.5 text-[10px] uppercase tracking-wide text-accent">
                              ◆ milestone
                            </span>
                          )}
                          {t.title}
                        </p>
                        {t.note && (
                          <p className="text-[12px] text-ink-soft mt-0.5 whitespace-pre-wrap">
                            {t.note}
                          </p>
                        )}
                        <p className="text-[12px] text-ink-faint mt-0.5">
                          {t.phase && <span className="mr-2">{t.phase}</span>}
                          {t.kind !== "milestone" &&
                            (t.assignee ? (
                              <span className="mr-2">→ {t.assignee.name}</span>
                            ) : (
                              <span className="mr-2 italic">unassigned</span>
                            ))}
                          {t.dueDate &&
                            (() => {
                              const overdue =
                                t.status !== "done" &&
                                t.dueDate < new Date().toISOString().slice(0, 10);
                              return (
                                <span className={`mr-2 ${overdue ? "text-red-500" : ""}`}>
                                  {overdue ? "⚠ was due " : "due "}
                                  {new Date(`${t.dueDate}T00:00:00`).toLocaleDateString(undefined, {
                                    day: "numeric",
                                    month: "short",
                                  })}
                                </span>
                              );
                            })()}
                          by {t.createdBy.name} · {timeAgo(t.updatedAt)}
                        </p>
                        {t.statusNote && (
                          <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-ink-soft rounded-lg bg-parchment-dark px-2.5 py-1.5">
                            <CornerDownRight size={11} className="mt-0.5 shrink-0 text-red-500" />
                            {t.statusNote}
                          </p>
                        )}
                      </div>

                      <select
                        value={t.status}
                        onChange={(e) => {
                          const next = e.target.value as TaskStatus;
                          if (next === "revision") {
                            setRevisionFor(t.id);
                            setRevisionNote("");
                          } else {
                            setStatus(t, next);
                          }
                        }}
                        className="rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-ink-soft outline-none shrink-0"
                      >
                        {STATUSES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => remove(t)}
                        className="p-1.5 rounded-lg text-ink-faint hover:text-red-500 hover:bg-parchment-dark opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Delete task"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {/* Revision feedback — lives on the task, not in a lost thread. */}
                    {revisionFor === t.id && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <input
                          autoFocus
                          value={revisionNote}
                          onChange={(e) => setRevisionNote(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              setStatus(t, "revision", revisionNote.trim() || undefined);
                              setRevisionFor(null);
                            }
                            if (e.key === "Escape") setRevisionFor(null);
                          }}
                          placeholder="What needs to change? (feedback for the revision)"
                          className="flex-1 rounded-lg border border-line bg-transparent px-3 py-1.5 text-[13px] outline-none focus:border-ink-faint"
                        />
                        <button
                          onClick={() => {
                            setStatus(t, "revision", revisionNote.trim() || undefined);
                            setRevisionFor(null);
                          }}
                          className="rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white hover:bg-accent-hover"
                        >
                          Send back
                        </button>
                        <button
                          onClick={() => setRevisionFor(null)}
                          className="rounded-lg px-2 py-1.5 text-[12px] text-ink-soft hover:bg-parchment-dark"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )
      )}

      {/* Archive — completed work leaves the board by itself, never gets lost. */}
      <section className="mt-6 border-t border-line pt-3">
        <button
          onClick={toggleArchive}
          className="flex items-center gap-2 text-[12.5px] text-ink-faint hover:text-ink transition-colors"
        >
          {showArchive ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Archive size={13} />
          Archive{archived ? ` · ${archived.length}` : ""}
          <span className="text-[11px]">
            — done tasks move here after 14 days (milestones stay on the board)
          </span>
        </button>

        {showArchive && (
          <div className="mt-3 space-y-1.5">
            {!archived && <p className="text-[13px] text-ink-faint">Loading…</p>}
            {archived && archived.length === 0 && (
              <p className="text-[13px] text-ink-faint">Nothing archived yet.</p>
            )}
            {archived && archived.length > 0 && archivedShown.length === 0 && (
              <p className="text-[13px] text-ink-faint">No archived tasks match the filters.</p>
            )}
            {archivedShown.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-line bg-card/60 px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] truncate">{t.title}</p>
                  <p className="text-[11px] text-ink-faint truncate">
                    {t.phase ? `${t.phase} · ` : ""}
                    {t.assignee?.name ?? "unassigned"} · done {t.updatedAt.slice(0, 10)}
                  </p>
                </div>
                <button
                  onClick={() => restore(t)}
                  disabled={restoring === t.id}
                  className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-ink-soft hover:border-ink-faint hover:text-ink disabled:opacity-50 shrink-0"
                  title="Bring back onto the board"
                >
                  <RotateCcw size={11} />
                  Restore
                </button>
              </div>
            ))}
            {archived && archived.length > 0 && (
              <p className="pt-1 text-[11px] text-ink-faint">
                Also documented in TASK-HISTORY.md inside the project folder — grouped by month,
                readable by the whole team and the agent.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
