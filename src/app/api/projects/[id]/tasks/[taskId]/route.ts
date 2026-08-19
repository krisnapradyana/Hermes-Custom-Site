import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { updateTask, deleteTask, Person, TaskStatus } from "@/lib/tasks-store";
import { readProjects } from "@/lib/projects-store";
import { notifyTaskAssigned } from "@/lib/slack-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id, taskId } = await params;

  let body: {
    title?: string;
    note?: string;
    phase?: string;
    assignee?: Person | null;
    status?: TaskStatus;
    statusNote?: string;
    startDate?: string | null;
    dueDate?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await updateTask(id, taskId, gate.person.key, body);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.code });
  }

  // Reassignment → DM the new assignee (skip assigning to yourself).
  if (body.assignee && body.assignee.key !== gate.person.key) {
    const project = (await readProjects()).find((p) => p.id === id);
    notifyTaskAssigned({
      assigneeSlackId: body.assignee.key,
      assigneeName: body.assignee.name,
      taskTitle: result.title,
      phase: result.phase,
      dueDate: result.dueDate,
      projectId: id,
      projectName: project?.name ?? id,
      byName: gate.person.name,
    });
  }

  return NextResponse.json({ task: result });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id, taskId } = await params;

  const result = await deleteTask(id, taskId, gate.person.key);
  if (typeof result === "object" && "error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.code });
  }
  return NextResponse.json({ ok: true });
}
