import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireUser } from "@/lib/user-key";
import { readProjects, updateProjects } from "@/lib/projects-store";
import { scheduleTrackerUpdate } from "@/lib/tracker";
import { uid } from "@/lib/uid";
import { Project } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLORS = ["#2a73e1", "#6a9b7e", "#7d8bc4", "#c4a35a", "#a3719b"];

async function creator(): Promise<{ name: string; slackId?: string }> {
  try {
    const s = await auth();
    if (s?.user) return { name: s.user.name ?? "Someone", slackId: s.user.slackId };
  } catch {}
  return { name: "You" };
}

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  return NextResponse.json({ projects: await readProjects() });
}

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  let body: Partial<Project>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  const by = await creator();
  let project: Project | null = null;
  await updateProjects((list) => {
    project = {
      id: uid("proj"),
      name: body.name!.trim(),
      description: body.description?.trim() ?? "",
      color: COLORS[list.length % COLORS.length],
      createdAt: new Date().toISOString(),
      workingFolder: body.workingFolder?.trim() || undefined,
      driveFolder: body.driveFolder?.trim() || undefined,
      createdBy: by,
    };
    return [...list, project];
  });
  scheduleTrackerUpdate();
  return NextResponse.json({ project });
}
