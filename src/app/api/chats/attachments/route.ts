import { NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { collectChatAttachments } from "@/lib/chats-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = await getUserKey();
  if (!key) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ attachments: await collectChatAttachments(key) });
}
