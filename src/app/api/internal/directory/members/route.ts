import { NextRequest, NextResponse } from "next/server";
import { readMembers } from "@/lib/members-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-to-server member list — lets Hermes read the directory so it can
 * match names against Slack users before calling ../link. Same INTERNAL_TOKEN
 * convention as the other /api/internal routes; the caller is a container,
 * not a person.
 */
export async function GET(req: NextRequest) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const members = await readMembers();
  return NextResponse.json({
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      primaryRole: m.primaryRole,
      slackId: m.slackId ?? null,
    })),
  });
}
