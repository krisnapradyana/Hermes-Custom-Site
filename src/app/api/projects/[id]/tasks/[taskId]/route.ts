import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import {
  updateTask,
  deleteTask,
  addTaskLink,
  removeTaskLink,
  Person,
  TaskStatus,
} from "@/lib/tasks-store";
import { readProjects } from "@/lib/projects-store";
import { notifyTaskAssigned } from "@/lib/slack-notify";
import { scheduleTeamStatusUpdate } from "@/lib/team-status";

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
    /** Reference links — open to anyone signed in, see tasks-store. */
    addLink?: { url?: string; label?: string };
    removeLink?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Link ops are their own verb: no assignee/creator gate, no updatedAt bump.
  if (body.addLink || body.removeLink) {
    const { addLink, removeLink, ...rest } = body;
    if (Object.keys(rest).length > 0) {
      return NextResponse.json(
        { error: "Send link changes in their own request" },
        { status: 400 }
      );
    }
    const linkResult = addLink
      ? await addTaskLink(id, taskId, gate.person, addLink)
      : await removeTaskLink(id, taskId, removeLink!);
    if ("error" in linkResult) {
      return NextResponse.json({ error: linkResult.error }, { status: linkResult.code });
    }
    return NextResponse.json({ task: linkResult });
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

  scheduleTeamStatusUpdate();
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
  scheduleTeamStatusUpdate();
  return NextResponse.json({ ok: true });
}
