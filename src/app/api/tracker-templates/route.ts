import { NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { listTemplates } from "@/lib/tracker-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saved tracker mapping templates — the wizard auto-applies on header match. */
export async function GET() {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  return NextResponse.json({ templates: await listTemplates() });
}
