import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requirePerson } from "@/lib/user-key";
import { readTrackerMapping, saveTrackerMapping } from "@/lib/tracker-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create or revoke the client share link for this project's tracker. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  let body: { action?: "create" | "revoke" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const mapping = await readTrackerMapping(id);
  if (!mapping) return NextResponse.json({ error: "No tracker connected" }, { status: 404 });

  if (body.action === "revoke") {
    delete mapping.shareToken;
    await saveTrackerMapping(id, mapping);
    return NextResponse.json({ ok: true, shareToken: null });
  }

  mapping.shareToken = randomBytes(24).toString("hex");
  await saveTrackerMapping(id, mapping);
  return NextResponse.json({ ok: true, shareToken: mapping.shareToken });
}
