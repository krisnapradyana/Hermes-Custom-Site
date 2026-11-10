import { NextResponse } from "next/server";
import { getMarketingViewer } from "@/lib/marketing-access";
import { CHECKERS, CHECKER_IDS } from "@/lib/marketing/checker-prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who am I, may I use the marketing platform — and, when allowed, which
 * checkers exist. The prompt text itself never leaves the server; the UI
 * only gets labels, context fields and the version tag.
 */
export async function GET() {
  const viewer = await getMarketingViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({
    allowed: viewer.allowed,
    name: viewer.name,
    checkers: viewer.allowed
      ? CHECKER_IDS.map((id) => {
          const c = CHECKERS[id];
          return { id: c.id, label: c.label, version: c.version, draftLabel: c.draftLabel, fields: c.fields };
        })
      : [],
  });
}
