import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireUser } from "@/lib/user-key";
import { getConversation, saveMessages, deleteConversation } from "@/lib/conversations-store";
import { Message } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ cid: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { cid } = await params;
  const conv = await getConversation(cid);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: conv });
}

async function isOwner(cid: string): Promise<boolean> {
  const conv = await getConversation(cid);
  if (!conv?.createdBy?.slackId) return true; // no owner recorded (dev/local) — allow
  try {
    const s = await auth();
    return s?.user?.slackId === conv.createdBy.slackId;
  } catch {
    return false;
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ cid: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { cid } = await params;
  if (!(await isOwner(cid))) {
    return NextResponse.json(
      { error: "Only the creator can edit this conversation" },
      { status: 403 }
    );
  }
  let body: { messages?: Message[]; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const conv = await saveMessages(cid, body.messages ?? [], body.title);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: conv });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ cid: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { cid } = await params;
  if (!(await isOwner(cid))) {
    return NextResponse.json(
      { error: "Only the creator can delete this conversation" },
      { status: 403 }
    );
  }
  await deleteConversation(cid);
  return NextResponse.json({ ok: true });
}
