"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GanttChart, ChevronDown, ChevronRight, Diamond, ListChecks } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { useFocusRefresh } from "@/lib/use-focus-refresh";
import { api } from "@/lib/api";

/**
 * Schedule — the studio-wide Gantt. One row per active scheduled project:
 * a bar from start to deadline in the project's color, milestone diamonds,
 * a TODAY line through everything. Project name jumps to the project;
 * the chevron expands the project's dated tasks inline on the same scale.
 */

interface GTask {
  id: string;
  kind?: "task" | "milestone";
  title: string;
  phase?: string;
  status: "todo" | "doing" | "review" | "revision" | "done";
  assignee?: { key: string; name: string };
  startDate?: string;
  dueDate?: string;
  createdAt: string;
}

const PHASE_COLORS: Record<string, string> = {
  Styleframes: "#c4a35a",
  Storyboard: "#7d8bc4",
  Animatic: "#6a9b7e",
  Animation: "#2a73e1",
  Render: "#a3719b",
  Revisions: "#d06565",
  "On-site": "#4fae9b",
  Other: "#8a8a8a",
};

const DAY = 86_400_000;
const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);

export default function SchedulePage() {
  const projects = useHermesStore((s) => s.projects);
  const loadProjects = useHermesStore((s) => s.loadProjects);
  const [tasksByProject, setTasksByProject] = useState<Record<string, GTask[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const scheduled = useMemo(
    () =>
      projects
        .filter((p) => !p.archived && (p.startDate || p.deadline))
        .sort((a, b) => (a.startDate ?? a.deadline ?? "").localeCompare(b.startDate ?? b.deadline ?? "")),
    [projects]
  );
  const unscheduled = useMemo(
    () => projects.filter((p) => !p.archived && !p.startDate && !p.deadline),
    [projects]
  );

  const load = useCallback(async () => {
    await loadProjects();
  }, [loadProjects]);
  useEffect(() => {
    load();
  }, [load]);
  useFocusRefresh(load);

  // Milestones (and expandable tasks) per scheduled project, in parallel.
  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        scheduled.map(async (p) => {
          const res = await api.get<{ tasks: GTask[] }>(
            `/api/projects/${encodeURIComponent(p.id)}/tasks`
          );
          return [p.id, res.ok ? res.data.tasks : []] as const;
        })
      );
      if (alive) setTasksByProject(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, [scheduled]);

  const model = useMemo(() => {
    if (scheduled.length === 0) return null;
    const todayDay = Math.floor((Date.now() + new Date().getTimezoneOffset() * -60000) / DAY);
    const days: number[] = [todayDay];
    for (const p of scheduled) {
      if (p.startDate) days.push(dayOf(p.startDate));
      if (p.deadline) days.push(dayOf(p.deadline));
      for (const t of tasksByProject[p.id] ?? []) if (t.dueDate) days.push(dayOf(t.dueDate));
    }
    const from = Math.min(...days) - 3;
    const to = Math.max(...days) + 4;
    const total = to - from + 1;
    const pct = (d: number) => ((d - from) / total) * 100;
    const spanPct = (a: number, b: number) => (Math.max(1, b - a + 1) / total) * 100;

    const mondays: { day: number; label: string }[] = [];
    for (let d = from; d <= to; d++) {
      if ((d + 3) % 7 === 0) {
        mondays.push({
          day: d,
          label: new Date(d * DAY).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        });
      }
    }
    // Crowded charts label every Nth Monday but keep every gridline.
    const labelEvery = Math.max(1, Math.ceil(mondays.length / 12));
    return { from, to, pct, spanPct, mondays, labelEvery, todayDay };
  }, [scheduled, tasksByProject]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
          <GanttChart size={17} className="text-accent" />
        </div>
        <h1 className="font-serif-display text-3xl">Schedule</h1>
      </div>
      <p className="text-sm text-ink-soft mb-8">
        Every active project on one timeline — click a name to open the project, the chevron to
        see its tasks.
      </p>

      {!model && (
        <p className="text-sm text-ink-faint text-center py-10">
          No scheduled projects yet — projects appear here once they have a start date and
          deadline.
        </p>
      )}

      {model && (
        <div className="rounded-xl border border-line bg-card p-4 overflow-x-auto">
          <div className="min-w-[44rem] relative">
            {/* Month/week labels */}
            <div className="relative h-5 mb-1 ml-[180px]">
              {model.mondays.map(
                (w, i) =>
                  i % model.labelEvery === 0 && (
                    <span
                      key={w.day}
                      className="absolute top-0 -translate-x-1/2 text-[10px] text-ink-faint whitespace-nowrap"
                      style={{ left: `${model.pct(w.day)}%` }}
                    >
                      {w.label}
                    </span>
                  )
              )}
            </div>

            <div className="relative">
              {/* gridlines + TODAY, spanning all rows (offset past the name column) */}
              <div className="absolute inset-y-0 left-[180px] right-0">
                {model.mondays.map((w) => (
                  <span
                    key={w.day}
                    className="absolute inset-y-0 w-px bg-line/50"
                    style={{ left: `${model.pct(w.day)}%` }}
                  />
                ))}
                {model.todayDay >= model.from && model.todayDay <= model.to && (
                  <div
                    className="absolute inset-y-0 w-0.5 bg-accent z-10"
                    style={{ left: `${model.pct(model.todayDay)}%` }}
                    title="Today"
                  >
                    <span className="absolute -top-0.5 left-1 text-[9px] font-medium text-accent">
                      TODAY
                    </span>
                  </div>
                )}
              </div>

              {scheduled.map((p) => {
                const tasks = tasksByProject[p.id] ?? [];
                const milestones = tasks.filter((t) => t.kind === "milestone" && t.dueDate);
                const dated = tasks.filter((t) => t.kind !== "milestone" && t.dueDate);
                const a = p.startDate ? dayOf(p.startDate) : dayOf(p.deadline!);
                const b = p.deadline ? dayOf(p.deadline) : a;
                const overdue = !!p.deadline && p.deadline < today;
                const isOpen = expanded === p.id;
                return (
                  <div key={p.id} className="relative">
                    <div className="flex items-center h-9">
                      <div className="w-[180px] shrink-0 flex items-center gap-1 pr-2 min-w-0">
                        <button
                          onClick={() => setExpanded(isOpen ? null : p.id)}
                          className="p-0.5 text-ink-faint hover:text-ink shrink-0"
                          title={isOpen ? "Hide tasks" : "Show tasks"}
                        >
                          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                        <Link
                          prefetch={false}
                          href={`/projects/${encodeURIComponent(p.id)}`}
                          className="text-[13px] font-medium truncate hover:text-accent transition-colors"
                          title={`Open ${p.name}`}
                        >
                          {p.name}
                        </Link>
                      </div>
                      <div className="flex-1 relative h-5">
                        <div
                          className={`absolute inset-y-0 rounded-md ${overdue ? "ring-1 ring-red-500" : ""}`}
                          style={{
                            left: `${model.pct(Math.min(a, b))}%`,
                            width: `${model.spanPct(Math.min(a, b), b)}%`,
                            backgroundColor: `${p.color}cc`,
                          }}
                          title={`${p.name} · ${p.startDate ?? "?"} → ${p.deadline ?? "?"}${overdue ? " · OVERDUE" : ""}`}
                        />
                        {milestones.map((m) => (
                          <span
                            key={m.id}
                            className="absolute top-1/2 -translate-y-1/2 z-10"
                            style={{ left: `${model.pct(dayOf(m.dueDate!))}%`, transform: "translate(-6px,-50%)" }}
                            title={`${m.title} — ${m.dueDate}`}
                          >
                            <Diamond
                              size={11}
                              className={m.status === "done" ? "text-green-500" : "text-parchment"}
                              fill="currentColor"
                            />
                          </span>
                        ))}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="pb-2">
                        {dated.length === 0 && (
                          <p className="ml-[180px] text-[11px] text-ink-faint py-1">
                            No dated tasks — set start/due dates on tasks to see them here.
                          </p>
                        )}
                        {dated.map((t) => {
                          const ta = dayOf(t.startDate ?? t.createdAt);
                          const tb = dayOf(t.dueDate!);
                          const tOver = t.status !== "done" && t.dueDate! < today;
                          return (
                            <div key={t.id} className="flex items-center h-6">
                              <div className="w-[180px] shrink-0" />
                              <div className="flex-1 relative h-4">
                                <div
                                  className={`absolute inset-y-0 rounded flex items-center px-1.5 overflow-hidden ${
                                    t.status === "done" ? "opacity-40" : ""
                                  } ${tOver ? "ring-1 ring-red-500" : ""}`}
                                  style={{
                                    left: `${model.pct(Math.min(ta, tb))}%`,
                                    width: `${model.spanPct(Math.min(ta, tb), tb)}%`,
                                    backgroundColor: `${PHASE_COLORS[t.phase ?? "Other"] ?? "#8a8a8a"}bb`,
                                  }}
                                  title={`${t.title}${t.assignee ? ` — ${t.assignee.name}` : ""} · due ${t.dueDate}`}
                                >
                                  <span className="text-[9.5px] text-white truncate">
                                    {t.title}
                                    {t.assignee ? ` · ${t.assignee.name.split(" ")[0]}` : ""}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div className="ml-[180px] pt-1">
                          <Link
                            prefetch={false}
                            href={`/projects/${encodeURIComponent(p.id)}/tasks`}
                            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                          >
                            <ListChecks size={11} />
                            Open Task Board
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-ink-faint">
              <span className="flex items-center gap-1">
                <Diamond size={9} className="text-ink-soft" fill="currentColor" /> milestone
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-2 rounded-sm ring-1 ring-red-500" /> overdue
              </span>
              <span>bar = project start → deadline · click the name to open the project</span>
            </div>
          </div>
        </div>
      )}

      {unscheduled.length > 0 && (
        <p className="mt-4 text-[12px] text-ink-faint">
          Not on the chart (no dates set):{" "}
          {unscheduled.map((p, i) => (
            <span key={p.id}>
              {i > 0 && " · "}
              <Link
                prefetch={false}
                href={`/projects/${encodeURIComponent(p.id)}`}
                className="hover:text-ink underline decoration-line"
              >
                {p.name}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
