import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { loadBlob, saveBlob, deleteBlob } from "@/lib/server-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  const blob = await loadBlob(key);
  return NextResponse.json({ blob });
}

export async function PUT(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  let body: { blob?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.blob !== "string" || body.blob.length > 50_000_000) {
    return NextResponse.json({ error: "Invalid blob" }, { status: 400 });
  }
  await saveBlob(key, body.blob);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;
  await deleteBlob(key);
  return NextResponse.json({ ok: true });
}
