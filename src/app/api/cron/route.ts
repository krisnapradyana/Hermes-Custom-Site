import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { passthrough } from "@/lib/hermes-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return passthrough("/api/jobs");
}

export async function POST(req: NextRequest) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.text();
  return passthrough("/api/jobs", { method: "POST", body });
}
