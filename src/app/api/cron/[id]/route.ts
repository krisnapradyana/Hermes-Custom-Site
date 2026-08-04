import { NextRequest } from "next/server";
import { requireUser } from "@/lib/user-key";
import { passthrough } from "@/lib/hermes-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  return passthrough(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  const body = await req.text();
  return passthrough(`/api/jobs/${encodeURIComponent(id)}`, { method: "PATCH", body });
}
