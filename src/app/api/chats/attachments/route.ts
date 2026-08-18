import { NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { collectChatAttachments } from "@/lib/chats-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  return NextResponse.json({ attachments: await collectChatAttachments(key) });
}
