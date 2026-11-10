import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canEditDirectory, findBySlackId, Member } from "@/lib/members-store";

/**
 * Access policy for the Marketing platform (marketing.* subdomain):
 *   allowed = signed in AND (
 *     their Directory record's type contains "marketing"   — the team itself
 *     OR it is a leadership type (canEditDirectory)         — reviewers
 *     OR their Slack id is in ADMIN_SLACK_IDS               — bootstrap
 *   )
 * The Directory is the single source of truth: to grant or remove access,
 * edit the member's type there. No open-alpha bypass — drafts and client
 * names live here. Auth-off dev mode is allowed so the UI works locally.
 */

export interface MarketingViewer {
  slackId: string;
  name: string;
  member?: Member;
  allowed: boolean;
}

function adminIds(): string[] {
  return (process.env.ADMIN_SLACK_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isMarketingType(type: string | undefined): boolean {
  return !!type && type.toLowerCase().includes("marketing");
}

export async function getMarketingViewer(): Promise<MarketingViewer | null> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") {
    return { slackId: "local", name: "Local User", allowed: true };
  }
  try {
    const session = await auth();
    const slackId = session?.user?.slackId;
    if (!slackId) return null;
    const member = await findBySlackId(slackId);
    const allowed =
      adminIds().includes(slackId) ||
      isMarketingType(member?.type) ||
      canEditDirectory(member?.type);
    return { slackId, name: member?.name ?? session?.user?.name ?? "Member", member, allowed };
  } catch {
    return null;
  }
}

export async function requireMarketingAccess(): Promise<
  | { viewer: MarketingViewer; denied?: undefined }
  | { viewer?: undefined; denied: NextResponse }
> {
  const viewer = await getMarketingViewer();
  if (!viewer) {
    return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  if (!viewer.allowed) {
    return { denied: NextResponse.json({ error: "Restricted" }, { status: 403 }) };
  }
  return { viewer };
}
