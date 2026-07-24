import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { listWorkspaceFiles } from "@/lib/agent-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists files the agent has written into this project's server workspace. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ files: await listWorkspaceFiles(id) });
}
