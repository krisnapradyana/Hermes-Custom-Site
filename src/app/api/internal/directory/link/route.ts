import { NextRequest, NextResponse } from "next/server";
import { readMembers, updateMember } from "@/lib/members-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-to-server bulk Slack-id linking — built for Hermes, which will match
 * directory names against workspace users and correct them later. Same
 * INTERNAL_TOKEN convention as the other /api/internal routes.
 *
 * POST body: { links: [{ memberId?, name?, slackId }] } — memberId wins;
 * name matching is case-insensitive on the record's name.
 */
export async function POST(req: NextRequest) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { links?: { memberId?: string; name?: string; slackId?: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.links)) {
    return NextResponse.json({ error: "links[] required" }, { status: 400 });
  }

  const members = await readMembers();
  const results: { slackId: string; linkedTo?: string; error?: string }[] = [];

  for (const link of body.links) {
    const slackId = link.slackId?.trim();
    if (!slackId) {
      results.push({ slackId: "", error: "missing slackId" });
      continue;
    }
    const target = link.memberId
      ? members.find((m) => m.id === link.memberId)
      : members.find((m) => m.name.toLowerCase() === link.name?.trim().toLowerCase());
    if (!target) {
      results.push({ slackId, error: `no member matches ${link.memberId ?? link.name}` });
      continue;
    }
    await updateMember(target.id, { slackId });
    results.push({ slackId, linkedTo: target.name });
  }

  return NextResponse.json({ results });
}
