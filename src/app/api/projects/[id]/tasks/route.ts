import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { listTasks, createTask, Person } from "@/lib/tasks-store";

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

  let body: { title?: string; note?: string; phase?: string; assignee?: Person };
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
  });
  return NextResponse.json({ task });
}
