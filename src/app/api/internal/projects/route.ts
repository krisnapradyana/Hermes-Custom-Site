import { NextRequest, NextResponse } from "next/server";
import { readProjects, updateProjects } from "@/lib/projects-store";
import { scheduleTrackerUpdate } from "@/lib/tracker";
import { uid } from "@/lib/uid";
import { Project, PROJECT_TAGS, ProjectTag } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-to-server projects API — the "single entry point" task: this app
 * stays the single writer of projects.json; siblings (timeclock) and the
 * Hermes agent read AND write over HTTP so a Slack brief can become a
 * project with no retyping. Guarded by the shared token, never a session.
 *
 * GET   → list (richer than before: dates/tags/description for chat-ops)
 * POST  → create {name, description?, startDate?, deadline?, tags?,
 *                 slackChannel?, createdBy?{name,slackId}}
 * PATCH → update {project: id|name, ...same fields, nulls clear dates}
 *
 * Deliberately NOT writable here: doneAt (the wrap/post-mortem flow owns
 * "done" — flagship gating must not be bypassable from chat), archived,
 * workingFolder/driveFolder (filesystem side-effects stay human-driven).
 */

const COLORS = ["#2a73e1", "#6a9b7e", "#7d8bc4", "#c4a35a", "#a3719b"];

function gate(req: NextRequest): NextResponse | null {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

const isoDate = (v: unknown): string | undefined =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;

const TAG_IDS: string[] = PROJECT_TAGS.map((t) => t.id);
const cleanTags = (v: unknown): ProjectTag[] | undefined =>
  Array.isArray(v)
    ? (v.filter((t) => typeof t === "string" && TAG_IDS.includes(t)) as ProjectTag[])
    : undefined;

/** id → exact name → unique partial name (same contract as the tasks API). */
function resolveProject(projects: Project[], query: string): Project | { error: string } {
  const q = query.trim().toLowerCase();
  const exact =
    projects.find((p) => p.id === query.trim()) ??
    projects.find((p) => p.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = projects.filter((p) => p.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length === 0) return { error: `No project matches "${query}"` };
  return {
    error: `"${query}" is ambiguous — matches: ${partial.map((p) => p.name).join(", ")}`,
  };
}

export async function GET(req: NextRequest) {
  const denied = gate(req);
  if (denied) return denied;

  // Archived projects disappear from the clock-in menu and chat-ops.
  const projects = (await readProjects())
    .filter((p) => !p.archived)
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      // Lets the clock app treat the creator's own projects as "assigned".
      createdBy: p.createdBy?.slackId,
      description: p.description,
      startDate: p.startDate,
      deadline: p.deadline,
      tags: p.tags,
      doneAt: p.doneAt ?? undefined,
    }));
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const denied = gate(req);
  if (denied) return denied;

  let body: {
    name?: unknown;
    description?: unknown;
    startDate?: unknown;
    deadline?: unknown;
    tags?: unknown;
    slackChannel?: unknown;
    createdBy?: { name?: unknown; slackId?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (typeof body.startDate === "string" && !isoDate(body.startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 422 });
  }
  if (typeof body.deadline === "string" && !isoDate(body.deadline)) {
    return NextResponse.json({ error: "deadline must be YYYY-MM-DD" }, { status: 422 });
  }

  const existing = await readProjects();
  const dup = existing.find((p) => !p.archived && p.name.toLowerCase() === name.toLowerCase());
  if (dup) {
    return NextResponse.json(
      { error: `A project named "${dup.name}" already exists (id ${dup.id}) — update it instead` },
      { status: 409 }
    );
  }

  const by =
    body.createdBy && typeof body.createdBy.name === "string" && body.createdBy.name.trim()
      ? {
          name: body.createdBy.name.trim(),
          ...(typeof body.createdBy.slackId === "string" && body.createdBy.slackId
            ? { slackId: body.createdBy.slackId }
            : {}),
        }
      : { name: "Hermes" };

  let project: Project | null = null;
  await updateProjects((list) => {
    project = {
      id: uid("proj"),
      name,
      description: typeof body.description === "string" ? body.description.trim() : "",
      color: COLORS[list.length % COLORS.length],
      createdAt: new Date().toISOString(),
      startDate: isoDate(body.startDate),
      deadline: isoDate(body.deadline),
      tags: cleanTags(body.tags),
      slackChannel:
        typeof body.slackChannel === "string" && body.slackChannel.trim()
          ? body.slackChannel.trim()
          : undefined,
      createdBy: by,
    };
    return [...list, project];
  });
  scheduleTrackerUpdate();

  const p = project as unknown as Project;
  return NextResponse.json({
    project: p,
    summary:
      `Created project "${p.name}"` +
      (p.startDate ? ` · starts ${p.startDate}` : "") +
      (p.deadline ? ` · deadline ${p.deadline}` : "") +
      (p.tags?.length ? ` · tags: ${p.tags.join(", ")}` : "") +
      ` · by ${by.name}`,
  });
}

export async function PATCH(req: NextRequest) {
  const denied = gate(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const query = typeof body.project === "string" ? body.project : "";
  if (!query.trim()) {
    return NextResponse.json({ error: "project (id or name) is required" }, { status: 400 });
  }
  // Reject fields this API refuses to write, loudly — silence would read as success.
  for (const k of ["doneAt", "archived", "workingFolder", "driveFolder"]) {
    if (k in body) {
      return NextResponse.json(
        { error: `${k} cannot be changed via this API — it is managed in the web app` },
        { status: 422 }
      );
    }
  }
  for (const k of ["startDate", "deadline"] as const) {
    if (k in body && body[k] !== null && !isoDate(body[k])) {
      return NextResponse.json({ error: `${k} must be YYYY-MM-DD or null` }, { status: 422 });
    }
  }

  const resolved = resolveProject(await readProjects(), query);
  if ("error" in resolved) return NextResponse.json({ error: resolved.error }, { status: 404 });

  const changed: string[] = [];
  let updated: Project | null = null;
  await updateProjects((list) => {
    const idx = list.findIndex((p) => p.id === resolved.id);
    if (idx === -1) return null;
    const next = { ...list[idx] };
    if (typeof body.name === "string" && body.name.trim() && body.name.trim() !== next.name) {
      next.name = body.name.trim();
      changed.push("name");
    }
    if (typeof body.description === "string" && body.description.trim() !== next.description) {
      next.description = body.description.trim();
      changed.push("description");
    }
    for (const k of ["startDate", "deadline"] as const) {
      if (k in body) {
        const v = body[k] === null ? undefined : isoDate(body[k]);
        if (v !== next[k]) {
          next[k] = v;
          changed.push(k);
        }
      }
    }
    if ("tags" in body) {
      next.tags = cleanTags(body.tags);
      changed.push("tags");
    }
    if (typeof body.slackChannel === "string") {
      next.slackChannel = body.slackChannel.trim() || undefined;
      changed.push("slackChannel");
    }
    const copy = [...list];
    copy[idx] = next;
    updated = next;
    return copy;
  });
  if (!updated) return NextResponse.json({ error: "Project vanished mid-update" }, { status: 409 });
  scheduleTrackerUpdate();

  const p = updated as unknown as Project;
  return NextResponse.json({
    project: p,
    changed,
    summary:
      changed.length === 0
        ? `No changes — "${p.name}" already matched`
        : `Updated "${p.name}": ${changed.join(", ")}` +
          (changed.includes("deadline") ? ` (deadline now ${p.deadline ?? "cleared"})` : ""),
  });
}
