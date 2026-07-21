import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { readProjects, writeProjects } from "@/lib/projects-store";
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

  const list = await readProjects();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return NextResponse.json({ error: "Not found" }, { status: 404 });

  for (const k of EDITABLE) {
    if (k in body) {
      const v = body[k];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (list[idx] as any)[k] = typeof v === "string" ? v.trim() || undefined : v;
    }
  }
  await writeProjects(list);
  return NextResponse.json({ project: list[idx] });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const list = await readProjects();
  await writeProjects(list.filter((p) => p.id !== id));
  return NextResponse.json({ ok: true });
}
