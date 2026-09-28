"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarRange, Users, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { CountUp } from "@/components/CountUp";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

/**
 * Project Overview strip — the at-a-glance header cards (approved reference
 * mock), built ONLY from data the system already tracks:
 *   window      → project startDate/deadline
 *   completed   → task store (done / total + donut)
 *   manpower    → live team pulse (who has time or tasks here, who's on now)
 *   attention   → nearest real thing to "blocked": revision + overdue tasks
 */

interface OvTask {
  id: string;
  title: string;
  kind?: "task" | "milestone";
  status: "todo" | "doing" | "review" | "revision" | "done";
  dueDate?: string;
  archivedAt?: string;
  assignee?: { key: string; name: string };
}

interface OvPulse {
  userKey: string;
  active: { projectId: string; breakAt?: string } | null;
  weekByProject: { projectId: string; ms: number }[];
  totalByProject?: { projectId: string; ms: number }[];
  tasks: { projectId: string; status: string }[];
}

const dayMs = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00`);
const fmtD = (iso: string) =>
  toDate(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });

export function ProjectOverview({
  projectId,
  startDate,
  deadline,
  isDone,
}: {
  projectId: string;
  startDate?: string;
  deadline?: string;
  isDone: boolean;
}) {
  const [tasks, setTasks] = useState<OvTask[] | null>(null);
  const [pulse, setPulse] = useState<OvPulse[] | null>(null);

  const load = useCallback(() => {
    api
      .get<{ tasks: OvTask[] }>(`/api/projects/${encodeURIComponent(projectId)}/tasks`)
      .then((r) => r.ok && setTasks(r.data.tasks));
    api
      .get<{ members: OvPulse[] }>("/api/team")
      .then((r) => r.ok && setPulse(r.data.members));
  }, [projectId]);

  useEffect(load, [load]);
  useFocusRefresh(load);

  // ---- tasks ----
  const real = (tasks ?? []).filter((t) => t.kind !== "milestone" && !t.archivedAt);
  const doneCount = real.filter((t) => t.status === "done").length;
  const total = real.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // ---- attention: revision + overdue (open tasks past their due date) ----
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const open = real.filter((t) => t.status !== "done");
  const revision = open.filter((t) => t.status === "revision").length;
  const overdue = open.filter(
    (t) => t.status !== "revision" && t.dueDate && toDate(t.dueDate) < today
  ).length;
  const attention = revision + overdue;
  const attentionSub =
    attention === 0
      ? "nothing flagged"
      : [revision > 0 ? `${revision} in revision` : "", overdue > 0 ? `${overdue} overdue` : ""]
          .filter(Boolean)
          .join(" · ");

  // ---- manpower: anyone with tracked time here or an open task here ----
  const involved = (pulse ?? []).filter(
    (m) =>
      m.weekByProject.some((w) => w.projectId === projectId && w.ms > 0) ||
      (m.totalByProject ?? []).some((w) => w.projectId === projectId && w.ms > 0) ||
      m.tasks.some((t) => t.projectId === projectId)
  );
  const workingNow = involved.filter(
    (m) => m.active?.projectId === projectId && !m.active.breakAt
  ).length;
  const onBreakHere = involved.filter(
    (m) => m.active?.projectId === projectId && m.active.breakAt
  ).length;
  const manpowerSub =
    involved.length === 0
      ? "no activity yet"
      : `${workingNow} working now${onBreakHere > 0 ? ` · ${onBreakHere} on break` : ""}`;

  // ---- window ----
  const hasWindow = !!(startDate && deadline);
  const windowDays = hasWindow
    ? Math.max(1, Math.round((+toDate(deadline!) - +toDate(startDate!)) / dayMs) + 1)
    : 0;
  const daysLeft = deadline ? Math.round((+toDate(deadline) - +today) / dayMs) : 0;
  const windowSub = !hasWindow
    ? "no schedule yet"
    : isDone
      ? "completed"
      : daysLeft > 0
        ? `${windowDays} calendar days · ${daysLeft} left`
        : daysLeft === 0
          ? `${windowDays} calendar days · due today`
          : `${windowDays} calendar days · ${-daysLeft}d over`;

  return (
    <div className="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {/* Production window */}
      <Card label="Production window" sub={windowSub} icon={<CalendarRange size={13} />}>
        <span
          className={`text-[22px] font-semibold leading-none tracking-tight whitespace-nowrap ${
            isDone
              ? "text-green-600 dark:text-green-400"
              : hasWindow && daysLeft < 0
                ? "text-red-500"
                : ""
          }`}
        >
          {hasWindow ? `${fmtD(startDate!)} → ${fmtD(deadline!)}` : "—"}
        </span>
      </Card>

      {/* Tasks completed + donut */}
      <Card label="Tasks completed" sub={total === 0 ? "no tasks yet" : `${pct}% of the board`}>
        <span className="flex items-center gap-3">
          <span className="text-[26px] font-semibold leading-none tabular-nums tracking-tight">
            <CountUp value={doneCount} /> / <CountUp value={total} />
          </span>
          <Donut pct={pct} />
        </span>
      </Card>

      {/* Manpower */}
      <Card label="Project manpower" sub={manpowerSub} icon={<Users size={13} />}>
        <span className="text-[26px] font-semibold leading-none tabular-nums tracking-tight">
          <CountUp value={involved.length} />{" "}
          <span className="text-[13px] font-normal text-ink-soft">
            {involved.length === 1 ? "person" : "people"}
          </span>
        </span>
      </Card>

      {/* Needs attention */}
      <Card label="Needs attention" sub={attentionSub} icon={<AlertTriangle size={13} />}>
        <span
          className={`text-[26px] font-semibold leading-none tabular-nums tracking-tight ${
            attention > 0 ? "text-amber-600 dark:text-amber-400" : "text-ink-faint"
          }`}
        >
          <CountUp value={attention} />
        </span>
      </Card>
    </div>
  );
}

function Card({
  label,
  sub,
  icon,
  children,
}: {
  label: string;
  sub: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-panel rounded-2xl border border-line/60 px-4 py-3.5 min-w-0">
      <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        {icon}
        {label}
      </p>
      {children}
      <p className="mt-1.5 truncate text-[11.5px] text-ink-faint">{sub}</p>
    </div>
  );
}

/** Tiny completion donut — pure SVG, animates via CSS transition. */
function Donut({ pct }: { pct: number }) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="20" cy="20" r={r} fill="none" strokeWidth="5" className="stroke-line" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-accent transition-[stroke-dashoffset] duration-700 ease-out"
        strokeDasharray={c}
        strokeDashoffset={c - (c * pct) / 100}
      />
    </svg>
  );
}
