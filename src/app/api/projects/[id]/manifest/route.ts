import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { readManifest, writeManifest } from "@/lib/projects-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 2_000_000; // 2MB manifest cap

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const json = await readManifest(id);
  return NextResponse.json({ manifest: json ? JSON.parse(json) : null });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const body = await req.text();
  if (body.length > MAX) return NextResponse.json({ error: "Manifest too large" }, { status: 413 });
  await writeManifest(id, body);
  return NextResponse.json({ ok: true });
}
