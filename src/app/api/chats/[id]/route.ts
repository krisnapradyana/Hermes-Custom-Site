import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import {
  getChat,
  saveChatMessages,
  patchChatMeta,
  deleteChat as removeChat,
} from "@/lib/chats-store";
import { Message } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGES = 2000;

/** Full chat including messages — loaded only when a chat is opened. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  const { id } = await params;
  const chat = await getChat(key, id);
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ chat });
}

/** Replace the messages of one chat (the streaming save path). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  const { id } = await params;

  let body: { messages?: Message[]; title?: string; pinned?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return NextResponse.json({ error: "messages array required" }, { status: 400 });
  }
  if (body.messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "Too many messages" }, { status: 413 });
  }

  const chat = await saveChatMessages(key, id, body.messages, {
    ...(body.title != null ? { title: body.title.slice(0, 200) } : {}),
    ...(body.pinned != null ? { pinned: body.pinned } : {}),
  });
  if (!chat) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, updatedAt: chat.updatedAt });
}

/** Metadata-only update (pin / rename) — does not rewrite messages. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  const { id } = await params;

  let body: { title?: string; pinned?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const meta = await patchChatMeta(key, id, {
    ...(body.title != null ? { title: body.title.slice(0, 200) } : {}),
    ...(body.pinned != null ? { pinned: body.pinned } : {}),
  });
  if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ chat: meta });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  const { id } = await params;
  await removeChat(key, id);
  return NextResponse.json({ ok: true });
}
