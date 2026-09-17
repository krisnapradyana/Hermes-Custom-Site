import type { Project } from "./types";
import type { Task } from "./tasks-store";

/**
 * Schedule rollups — turns a project + its tasks into the handful of numbers
 * a producer reads off the Gantt: health, progress, milestones, what's next,
 * who's on it. Pure functions, no I/O, shared by /api/schedule and tests.
 *
 * Health is deliberately simple and explainable:
 *   done   — project marked done
 *   late   — deadline passed, not done
 *   plan   — no tasks yet (nothing to measure progress against)
 *   risk   — share of tasks done trails share of time elapsed by > RISK_GAP
 *   ok     — everything else
 */

export type Health = "ok" | "risk" | "late" | "done" | "plan";

export const RISK_GAP = 0.15;

const DAY = 86_400_000;
export const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);

export interface RollupMilestone {
  id: string;
  title: string;
  dueDate: string;
  /** hit = done · open = upcoming · missed = due date passed, not done */
  state: "hit" | "open" | "missed";
}

export interface RollupTask {
  id: string;
  title: string;
  phase?: string;
  status: Task["status"];
  assignee?: { key: string; name: string };
  startDate?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  /** Days sitting in review/revision without a status change (0 when n/a). */
  waitingDays: number;
}

export interface ProjectRollup {
  id: string;
  name: string;
  color: string;
  startDate?: string;
  deadline?: string;
  doneAt?: string | null;
  health: Health;
  /** Positive when late: days past the deadline. */
  daysLate: number;
  /** 0..1 share of the start→deadline window that has elapsed (clamped). */
  timeElapsed: number;
  tasks: { total: number; done: number; review: number; revision: number; unowned: number };
  /** 0..1 share of tasks done; null when there are no tasks. */
  progress: number | null;
  milestones: RollupMilestone[];
  /** The single next thing: soonest open milestone, else the deadline. */
  nextUp: { title: string; date: string; kind: "milestone" | "deadline"; daysAway: number } | null;
  /** Distinct people assigned to open tasks, most-loaded first. */
  people: { key: string; name: string; open: number }[];
  /** Dated, non-milestone tasks for the expanded row (open first). */
  taskRows: RollupTask[];
  lastActivityAt: string | null;
}

export function rollupProject(p: Project, tasks: Task[], today: string): ProjectRollup {
  const todayDay = dayOf(today);
  const milestonesRaw = tasks.filter((t) => t.kind === "milestone");
  const work = tasks.filter((t) => t.kind !== "milestone");

  const counts = {
    total: work.length,
    done: work.filter((t) => t.status === "done").length,
    review: work.filter((t) => t.status === "review").length,
    revision: work.filter((t) => t.status === "revision").length,
    unowned: work.filter((t) => t.status !== "done" && !t.assignee).length,
  };
  const progress = counts.total ? counts.done / counts.total : null;

  // Time elapsed across the planned window (createdAt stands in for a missing start).
  const start = p.startDate ?? p.createdAt.slice(0, 10);
  const startDay = dayOf(start);
  const endDay = p.deadline ? dayOf(p.deadline) : null;
  let timeElapsed = 0;
  if (endDay != null && endDay > startDay) {
    timeElapsed = Math.max(0, Math.min(1, (todayDay - startDay) / (endDay - startDay)));
  } else if (endDay != null) {
    timeElapsed = todayDay >= endDay ? 1 : 0;
  }
  const daysLate = !p.doneAt && endDay != null && todayDay > endDay ? todayDay - endDay : 0;

  let health: Health;
  if (p.doneAt) health = "done";
  else if (daysLate > 0) health = "late";
  else if (progress == null) health = "plan";
  else if (progress < timeElapsed - RISK_GAP) health = "risk";
  else health = "ok";

  const milestones: RollupMilestone[] = milestonesRaw
    .filter((m) => !!m.dueDate)
    .map((m): RollupMilestone => ({
      id: m.id,
      title: m.title,
      dueDate: m.dueDate!,
      state: m.status === "done" ? "hit" : m.dueDate! < today ? "missed" : "open",
    }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  let nextUp: ProjectRollup["nextUp"] = null;
  if (!p.doneAt) {
    const nextMs = milestones.find((m) => m.state === "open");
    if (nextMs) {
      nextUp = {
        title: nextMs.title,
        date: nextMs.dueDate,
        kind: "milestone",
        daysAway: dayOf(nextMs.dueDate) - todayDay,
      };
    } else if (p.deadline) {
      nextUp = {
        title: "Deadline",
        date: p.deadline,
        kind: "deadline",
        daysAway: dayOf(p.deadline) - todayDay,
      };
    }
  }

  const peopleMap = new Map<string, { key: string; name: string; open: number }>();
  for (const t of work) {
    if (t.status === "done" || !t.assignee) continue;
    const cur = peopleMap.get(t.assignee.key) ?? { ...t.assignee, open: 0 };
    cur.open += 1;
    peopleMap.set(t.assignee.key, cur);
  }
  const people = [...peopleMap.values()].sort((a, b) => b.open - a.open);

  const statusOrder: Record<Task["status"], number> = {
    revision: 0,
    review: 1,
    doing: 2,
    todo: 3,
    done: 4,
  };
  const taskRows: RollupTask[] = work
    .filter((t) => !!t.dueDate)
    .map((t) => ({
      id: t.id,
      title: t.title,
      phase: t.phase,
      status: t.status,
      assignee: t.assignee,
      startDate: t.startDate,
      dueDate: t.dueDate,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      waitingDays:
        t.status === "review" || t.status === "revision"
          ? Math.max(0, todayDay - dayOf(t.updatedAt))
          : 0,
    }))
    .sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] || a.dueDate!.localeCompare(b.dueDate!)
    );

  const lastActivityAt =
    tasks.map((t) => t.updatedAt).sort((a, b) => b.localeCompare(a))[0] ?? null;

  return {
    id: p.id,
    name: p.name,
    color: p.color,
    startDate: p.startDate,
    deadline: p.deadline,
    doneAt: p.doneAt ?? null,
    health,
    daysLate,
    timeElapsed,
    tasks: counts,
    progress,
    milestones,
    nextUp,
    people,
    taskRows,
    lastActivityAt,
  };
}

/** Urgency order for the default sort: late → at risk → soonest next-up → plan → done. */
export function urgencyRank(r: ProjectRollup): number {
  const base: Record<Health, number> = { late: 0, risk: 1, ok: 2, plan: 3, done: 4 };
  const days = r.nextUp?.daysAway ?? 9_999;
  return base[r.health] * 100_000 + (r.health === "late" ? -r.daysLate : days);
}
