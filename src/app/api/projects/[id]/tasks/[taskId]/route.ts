import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { updateTask, deleteTask, Person, TaskStatus } from "@/lib/tasks-store";

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
