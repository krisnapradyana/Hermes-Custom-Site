import { NextRequest, NextResponse } from "next/server";
import { requireDirectoryAccess } from "@/lib/directory-access";
import { createMember, readMembers } from "@/lib/members-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireDirectoryAccess();
  if (gate.denied) return gate.denied;
  const members = await readMembers();
  return NextResponse.json({
    members: members.sort((a, b) => a.name.localeCompare(b.name)),
  });
}

/** Register a new member. Name, type and primary role are required. */
export async function POST(req: NextRequest) {
  const gate = await requireDirectoryAccess();
  if (gate.denied) return gate.denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type = typeof body.type === "string" ? body.type.trim() : "";
  const primaryRole = typeof body.primaryRole === "string" ? body.primaryRole.trim() : "";
  if (!name || !type || !primaryRole) {
    return NextResponse.json(
      { error: "Name, type and primary role are required" },
      { status: 400 }
    );
  }

  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];

  const member = await createMember({
    name,
    type,
    primaryRole,
    secondaryRoles: asList(body.secondaryRoles),
    capabilities: asList(body.capabilities),
    trajectory: typeof body.trajectory === "string" ? body.trajectory : undefined,
    employment: typeof body.employment === "string" ? body.employment : undefined,
    location: typeof body.location === "string" ? body.location : undefined,
    slackId: typeof body.slackId === "string" ? body.slackId : undefined,
  });
  return NextResponse.json({ member }, { status: 201 });
}
