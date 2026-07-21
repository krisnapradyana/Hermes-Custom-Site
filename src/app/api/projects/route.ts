import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserKey } from "@/lib/user-key";
import { readProjects, writeProjects } from "@/lib/projects-store";
import { Project } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let counter = 0;
const uid = () => `proj-${Date.now()}-${counter++}`;
const COLORS = ["#2a73e1", "#6a9b7e", "#7d8bc4", "#c4a35a", "#a3719b"];

async function creator(): Promise<{ name: string; slackId?: string }> {
  try {
    const s = await auth();
    if (s?.user) return { name: s.user.name ?? "Someone", slackId: s.user.slackId };
  } catch {}
  return { name: "You" };
}

export async function GET() {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ projects: await readProjects() });
}

export async function POST(req: NextRequest) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let body: Partial<Project>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const list = await readProjects();
  const project: Project = {
    id: uid(),
    name: body.name.trim(),
    description: body.description?.trim() ?? "",
    color: COLORS[list.length % COLORS.length],
    createdAt: new Date().toISOString(),
    workingFolder: body.workingFolder?.trim() || undefined,
    driveFolder: body.driveFolder?.trim() || undefined,
    createdBy: await creator(),
  };
  list.push(project);
  await writeProjects(list);
  return NextResponse.json({ project });
}
