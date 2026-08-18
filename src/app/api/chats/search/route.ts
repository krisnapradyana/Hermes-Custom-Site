import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { searchChats } from "@/lib/chats-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 200);
  return NextResponse.json({ results: await searchChats(key, q) });
}
