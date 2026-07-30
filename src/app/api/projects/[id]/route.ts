import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { updateProjects } from "@/lib/projects-store";
import { Project } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE: (keyof Project)[] = [
  "name",
  "description",
  "workingFolder",
  "driveFolder",
  "slackChannel",
];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  let body: Partial<Project>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let updated: Project | undefined;
  await updateProjects((list) => {
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return null; // abort, no write
    const next = { ...list[idx] } as Record<string, unknown>;
    for (const k of EDITABLE) {
      if (k in body) {
        const v = body[k];
        next[k] = typeof v === "string" ? v.trim() || undefined : v;
      }
    }
    updated = next as unknown as Project;
    return list.map((p, i) => (i === idx ? updated! : p));
  });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  await updateProjects((list) => list.filter((p) => p.id !== id));
  return NextResponse.json({ ok: true });
}
