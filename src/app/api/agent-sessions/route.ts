import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { passthrough } from "@/lib/hermes-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const limit = req.nextUrl.searchParams.get("limit") ?? "50";
  return passthrough(`/api/sessions?limit=${encodeURIComponent(limit)}`);
}
