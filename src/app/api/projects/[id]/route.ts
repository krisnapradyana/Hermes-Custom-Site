import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { updateProjects } from "@/lib/projects-store";
import { scheduleTrackerUpdate } from "@/lib/tracker";
import { Project } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The working folder is deliberately NOT editable: the agent's files, the
// folder manifest, thumbnails and TASK-HISTORY all live there — re-pointing
// it after creation would orphan them. Name/description are safe to change:
// every link (chats, tasks, artifacts, clock sessions) uses the project id.
const EDITABLE: (keyof Project)[] = [
  "name",
  "description",
  "slackChannel",
  "archived",
  "startDate",
  "deadline",
];

const isoDate = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  let body: Partial<Project>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let updated: Project | undefined;
  let badRequest: string | null = null;
  await updateProjects((list) => {
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return null; // abort, no write
    const next = { ...list[idx] } as Record<string, unknown>;
    for (const k of EDITABLE) {
      if (k in body) {
        const v = body[k];
        next[k] = typeof v === "string" ? v.trim() : v;
      }
    }
    // name/description are REQUIRED strings on the Project type — an empty
    // edit must never turn them undefined (that crashed the search filter).
    if (!next.name) {
      badRequest = "Project name cannot be empty";
      return null; // abort the write
    }
    if (typeof next.description !== "string") next.description = "";
    if (!next.slackChannel) next.slackChannel = undefined;
    // Dates must be plain ISO (YYYY-MM-DD) or absent — garbage never lands.
    next.startDate = isoDate(next.startDate);
    next.deadline = isoDate(next.deadline);
    updated = next as unknown as Project;
    return list.map((p, i) => (i === idx ? updated! : p));
  });
  if (badRequest) return NextResponse.json({ error: badRequest }, { status: 400 });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  scheduleTrackerUpdate();
  return NextResponse.json({ project: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  await updateProjects((list) => list.filter((p) => p.id !== id));
  scheduleTrackerUpdate();
  return NextResponse.json({ ok: true });
}
