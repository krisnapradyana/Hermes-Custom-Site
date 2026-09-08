import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { readBrief, saveBrief, deleteBrief } from "@/lib/briefs-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  const brief = await readBrief(id);
  if (!brief) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ brief });
}

/** Attach to / detach from a project (the only editable field for now). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  const brief = await readBrief(id);
  if (!brief) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { projectId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if ("projectId" in body) {
    brief.projectId = body.projectId || undefined;
  }
  await saveBrief(brief);
  return NextResponse.json({ brief: { ...brief, markdown: undefined } });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  await deleteBrief(id);
  return NextResponse.json({ ok: true });
}
