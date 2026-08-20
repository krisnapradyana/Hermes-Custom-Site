import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { restoreTask } from "@/lib/tasks-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bring an archived task back onto the board (safety net — any member). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id, taskId } = await params;
  const task = await restoreTask(id, taskId);
  if (!task) return NextResponse.json({ error: "Not found in archive" }, { status: 404 });
  return NextResponse.json({ task });
}
