import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { listTasks, createTask, Person } from "@/lib/tasks-store";
import { readProjects } from "@/lib/projects-store";
import { notifyTaskAssigned } from "@/lib/slack-notify";
import { scheduleTeamStatusUpdate } from "@/lib/team-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  return NextResponse.json({ tasks: await listTasks(id) });
}

/** Create a task. Anyone signed in can create and assign. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  let body: {
    title?: string;
    note?: string;
    phase?: string;
    assignee?: Person;
    startDate?: string;
    dueDate?: string;
    kind?: "task" | "milestone";
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const task = await createTask(id, gate.person, {
    title: body.title.trim(),
    note: body.note,
    phase: body.phase,
    assignee: body.assignee,
    startDate: body.startDate,
    dueDate: body.dueDate,
    kind: body.kind,
  });

  // DM the assignee via the Hermes Slack bot (skip self-assignment).
  if (task.assignee && task.assignee.key !== gate.person.key) {
    const project = (await readProjects()).find((p) => p.id === id);
    notifyTaskAssigned({
      assigneeSlackId: task.assignee.key,
      assigneeName: task.assignee.name,
      taskTitle: task.title,
      phase: task.phase,
      dueDate: task.dueDate,
      projectId: id,
      projectName: project?.name ?? id,
      byName: gate.person.name,
    });
  }

  scheduleTeamStatusUpdate();
  return NextResponse.json({ task });
}
