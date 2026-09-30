import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { readProjects } from "@/lib/projects-store";
import { tasksForAssignee } from "@/lib/tasks-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Team Pulse data: the clock app's member overview, enriched with project
 * names. Fetched server-to-server over the Docker network (TIMECLOCK_URL,
 * default http://attendee-ui:3000) with the shared INTERNAL_TOKEN.
 * Briefly cached so the page's poll doesn't hammer the clock app.
 */

interface MemberPulse {
  userKey: string;
  name: string;
  active: { projectId: string; inAt: string } | null;
  todayMs: number;
  weekMs: number;
  lastSeen: string | null;
  weekByProject: { projectId: string; ms: number }[];
  monthByProject?: { projectId: string; ms: number }[];
}

let cache: { at: number; key: string; body: unknown } | null = null;
const TTL = 5_000;

export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const monthQ = req.nextUrl.searchParams.get("month");
  const month = monthQ && /^\d{4}-\d{2}$/.test(monthQ) ? monthQ : "";
  if (cache && cache.key === month && Date.now() - cache.at < TTL) {
    return NextResponse.json(cache.body);
  }

  const base = (process.env.TIMECLOCK_URL ?? "http://attendee-ui:3000").replace(/\/$/, "");
  const token = process.env.INTERNAL_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Timeclock integration is not configured (INTERNAL_TOKEN missing)" },
      { status: 501 }
    );
  }

  let members: MemberPulse[] = [];
  try {
    const res = await fetch(`${base}/api/timeclock/overview${month ? `?month=${month}` : ""}`, {
      headers: { "x-internal-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`clock app answered ${res.status}`);
    members = ((await res.json()) as { members: MemberPulse[] }).members;
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reach the clock app: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }

  // Studio month figures — aggregated HERE and stripped from the member
  // objects below, deliberately: the load panel and pies are studio gauges,
  // not individual surveillance. Per-member month data never reaches the UI.
  const studioMonthByProject: Record<string, number> = {};
  let monthMs = 0;
  for (const m of members) {
    for (const w of m.monthByProject ?? []) {
      studioMonthByProject[w.projectId] = (studioMonthByProject[w.projectId] ?? 0) + w.ms;
      monthMs += w.ms;
    }
    delete m.monthByProject;
  }

  // Resolve project ids → names/colors so the page never shows raw ids.
  const projects = await readProjects();
  const projectInfo = Object.fromEntries(
    projects.map((p) => [p.id, { name: p.name, color: p.color }])
  );

  // Each member's open tasks — powers the expanded "what are they on" view.
  const withTasks = await Promise.all(
    members.map(async (m) => ({
      ...m,
      tasks: (await tasksForAssignee(m.userKey)).map((t) => ({
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        phase: t.phase,
        status: t.status,
        dueDate: t.dueDate,
      })),
    }))
  );

  const body = {
    members: withTasks,
    projects: projectInfo,
    studioMonthMs: monthMs,
    studioMonthByProject,
  };
  cache = { at: Date.now(), key: month, body };
  return NextResponse.json(body);
}
