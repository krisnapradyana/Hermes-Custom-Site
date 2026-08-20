import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { listArchived } from "@/lib/tasks-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Swept (completed, 14+ days old) tasks — searchable history, restorable. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  return NextResponse.json({ tasks: await listArchived(id) });
}
