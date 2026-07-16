import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { passthrough } from "@/lib/hermes-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  return passthrough(`/api/sessions/${encodeURIComponent(id)}/messages`);
}
