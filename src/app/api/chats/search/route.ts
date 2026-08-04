import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { searchChats } from "@/lib/chats-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const key = await getUserKey();
  if (!key) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  return NextResponse.json({ results: await searchChats(key, q) });
}
