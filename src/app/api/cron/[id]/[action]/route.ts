import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { passthrough } from "@/lib/hermes-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["pause", "resume", "run"]);

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id, action } = await params;
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  return passthrough(`/api/jobs/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}
