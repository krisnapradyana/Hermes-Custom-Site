import { NextRequest, NextResponse } from "next/server";
import { tasksForAssignee } from "@/lib/tasks-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open tasks for one member — read by the clock app (server-to-server). */
export async function GET(req: NextRequest) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const assignee = req.nextUrl.searchParams.get("assignee") ?? "";
  if (!assignee) return NextResponse.json({ error: "assignee required" }, { status: 400 });
  return NextResponse.json({ tasks: await tasksForAssignee(assignee) });
}
