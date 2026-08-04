import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { listWorkspaceFiles } from "@/lib/agent-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lists files the agent has written into this project's server workspace. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  return NextResponse.json({ files: await listWorkspaceFiles(id) });
}
