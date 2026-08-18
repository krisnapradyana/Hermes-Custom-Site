"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, Trash2, CornerDownRight } from "lucide-react";
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

interface Task {
  id: string;
  projectId: string;
  title: string;
  note?: string;
  phase?: string;
  assignee?: Person;
  status: TaskStatus;
  statusNote?: string;
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

export function TaskBoard({ projectId }: { projectId: string }) {
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
    if (res.ok) setTasks(res.data.tasks);
    else setError(res.error);
  }, [projectId]);

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
  const [phase, setPhase] = useState("");
  const [assigneeKey, setAssigneeKey] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!title.trim() || creating) return;
    setCreating(true);
    const assignee = people.find((p) => p.key === assigneeKey);
    const res = await api.post<{ task: Task }>(
      `/api/projects/${encodeURIComponent(projectId)}/tasks`,
      { title: title.trim(), phase: phase || undefined, assignee }
    );
    if (res.ok) {
      setTitle("");
      setPhase("");
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

  const grouped = STATUSES.map((s) => ({
    ...s,
    items: (tasks ?? []).filter((t) => t.status === s.id),
  }));

  return (
    <div className="mb-10">
      <p className="text-[12px] text-ink-faint mb-3">
        Assign work and track iteration — to do → doing → review → revision → done. Only the
        assignee or the creator can move a task.
      </p>

      {/* New task */}
      <div className="mb-5 rounded-xl border border-line bg-card p-3 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New task — e.g. Styleframes v2 for scene 3"
          className="flex-1 min-w-[12rem] rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
        />
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
        <button
          onClick={create}
          disabled={!title.trim() || creating}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}
      {!tasks && !error && <p className="text-sm text-ink-faint">Loading…</p>}
      {tasks && tasks.length === 0 && (
        <p className="text-sm text-ink-faint">No tasks yet — add the first one above.</p>
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
                        <p className="text-sm font-medium">{t.title}</p>
                        <p className="text-[12px] text-ink-faint">
                          {t.phase && <span className="mr-2">{t.phase}</span>}
                          {t.assignee ? (
                            <span className="mr-2">→ {t.assignee.name}</span>
                          ) : (
                            <span className="mr-2 italic">unassigned</span>
                          )}
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
    </div>
  );
}
