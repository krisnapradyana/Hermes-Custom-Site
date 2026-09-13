import { NextRequest, NextResponse } from "next/server";
import { requireDirectoryAccess } from "@/lib/directory-access";
import { deleteMember, Member, updateMember } from "@/lib/members-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireDirectoryAccess();
  if (gate.denied) return gate.denied;
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Whitelist the patch — ids/timestamps are the store's business.
  const patch: Partial<Omit<Member, "id" | "createdAt">> = {};
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const asList = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : undefined;

  if (str(body.name)?.trim()) patch.name = str(body.name);
  if (str(body.type)?.trim()) patch.type = str(body.type);
  if (str(body.primaryRole)?.trim()) patch.primaryRole = str(body.primaryRole);
  if (asList(body.secondaryRoles)) patch.secondaryRoles = asList(body.secondaryRoles);
  if (asList(body.capabilities)) patch.capabilities = asList(body.capabilities);
  // These accept "" to clear the field (store maps "" → undefined for slackId).
  if (str(body.trajectory) !== undefined) patch.trajectory = str(body.trajectory) || undefined;
  if (str(body.employment) !== undefined) patch.employment = str(body.employment) || undefined;
  if (str(body.location) !== undefined) patch.location = str(body.location) || undefined;
  if (str(body.slackId) !== undefined) patch.slackId = str(body.slackId);

  const member = await updateMember(id, patch);
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ member });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireDirectoryAccess();
  if (gate.denied) return gate.denied;
  const { id } = await ctx.params;
  await deleteMember(id);
  return NextResponse.json({ ok: true });
}
