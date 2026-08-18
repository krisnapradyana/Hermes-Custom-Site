import { NextRequest, NextResponse } from "next/server";
import { updateTask, TaskStatus } from "@/lib/tasks-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status change on behalf of a member — called by the clock app when an
 * artist starts a task (→ doing) or sends it to review. The permission
 * check (assignee or creator only) runs inside updateTask.
 */
export async function POST(req: NextRequest) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    projectId?: string;
    taskId?: string;
    userKey?: string;
    status?: TaskStatus;
    statusNote?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.projectId || !body.taskId || !body.userKey || !body.status) {
    return NextResponse.json(
      { error: "projectId, taskId, userKey, status required" },
      {
        status: 400,
      }
    );
  }

  const result = await updateTask(body.projectId, body.taskId, body.userKey, {
    status: body.status,
    statusNote: body.statusNote,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.code });
  }
  return NextResponse.json({ task: result });
}
