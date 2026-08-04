import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireUser } from "@/lib/user-key";
import { listByProject, createConversation } from "@/lib/conversations-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function creator(): Promise<{ name: string; slackId?: string }> {
  try {
    const s = await auth();
    if (s?.user) return { name: s.user.name ?? "Someone", slackId: s.user.slackId };
  } catch {}
  return { name: "You" };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  return NextResponse.json({ conversations: await listByProject(id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  let body: { title?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const conv = await createConversation(id, body.title ?? "New conversation", await creator());
  return NextResponse.json({ conversation: conv });
}
