import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { readProjects } from "@/lib/projects-store";
import { listTasks } from "@/lib/tasks-store";
import { rollupProject, urgencyRank, type ProjectRollup } from "@/lib/schedule-rollup";
import { fetchTimeclockOverview } from "@/lib/timeclock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One call for the Schedule page: every non-archived project that has a
 * start date or deadline, rolled up (health, progress, milestones, next-up,
 * people, dated tasks), plus an optional live team snapshot from the
 * timeclock (who is clocked into what right now, hours this week).
 * Replaces the page's N per-project task fetches.
 */

export interface ScheduleTeamMember {
  key: string;
  name: string;
  activeProjectId: string | null;
  activeSince: string | null;
  weekMs: number;
}

export interface SchedulePayload {
  today: string;
  projects: ProjectRollup[];
  /** Projects with no dates at all — listed under the chart, never drawn. */
  unscheduled: { id: string; name: string }[];
  /** null when the timeclock integration is off or unreachable. */
  team: ScheduleTeamMember[] | null;
}

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const today = new Date().toISOString().slice(0, 10);
  const projects = (await readProjects()).filter((p) => !p.archived);
  const scheduled = projects.filter((p) => p.startDate || p.deadline);

  const [rollups, clock] = await Promise.all([
    Promise.all(scheduled.map(async (p) => rollupProject(p, await listTasks(p.id), today))),
    fetchTimeclockOverview(),
  ]);
  rollups.sort((a, b) => urgencyRank(a) - urgencyRank(b));

  const team: ScheduleTeamMember[] | null = clock
    ? clock.map((m) => ({
        key: m.userKey,
        name: m.name,
        activeProjectId: m.active?.projectId ?? null,
        activeSince: m.active?.inAt ?? null,
        weekMs: m.weekMs,
      }))
    : null;

  const body: SchedulePayload = {
    today,
    projects: rollups,
    unscheduled: projects
      .filter((p) => !p.startDate && !p.deadline)
      .map((p) => ({ id: p.id, name: p.name })),
    team,
  };
  return NextResponse.json(body);
}
