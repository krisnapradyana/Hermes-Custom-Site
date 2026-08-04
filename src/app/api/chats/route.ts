import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { listChats, saveChat } from "@/lib/chats-store";
import { migrateUserChats } from "@/lib/chats-migrate";
import { Chat } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Private chats, metadata only. Messages live at /api/chats/[id] so the
 * sidebar never downloads megabytes of history to render a list of titles.
 * Migration from the legacy single-blob state runs lazily on first list.
 */

export async function GET() {
  const key = await getUserKey();
  if (!key) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const migration = await migrateUserChats(key);
  const chats = await listChats(key);
  return NextResponse.json({ chats, migration: migration.migrated ? migration : undefined });
}

/** Create a chat (metadata + optional initial messages). */
export async function POST(req: NextRequest) {
  const key = await getUserKey();
  if (!key) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: Partial<Chat>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const now = new Date().toISOString();
  const chat: Chat = {
    id: body.id,
    title: (body.title ?? "New chat").slice(0, 200),
    pinned: !!body.pinned,
    projectId: body.projectId,
    messages: body.messages ?? [],
    createdAt: body.createdAt ?? now,
    updatedAt: now,
  };
  await saveChat(key, chat);
  return NextResponse.json({ chat });
}
