import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canEditDirectory, findBySlackId, Member } from "@/lib/members-store";

/**
 * Access policy for the Member Directory:
 *   allowed = signed in AND (
 *     their linked member record has a leadership type   — the normal path
 *     OR their Slack id is in ADMIN_SLACK_IDS            — bootstrap, before
 *                                                          any records are linked
 *   )
 * Everyone else gets the "contact your administrator" screen (403 on the API).
 * Auth-off dev mode is treated as an admin so the UI is workable locally.
 */

export interface DirectoryViewer {
  slackId: string;
  name: string;
  member?: Member;
  isAdmin: boolean;
}

function adminIds(): string[] {
  return (process.env.ADMIN_SLACK_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function getDirectoryViewer(): Promise<DirectoryViewer | null> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") {
    return { slackId: "local", name: "Local User", isAdmin: true };
  }
  try {
    const session = await auth();
    const slackId = session?.user?.slackId;
    if (!slackId) return null;
    const member = await findBySlackId(slackId);
    const isAdmin = adminIds().includes(slackId) || canEditDirectory(member?.type);
    return { slackId, name: session?.user?.name ?? "Member", member, isAdmin };
  } catch {
    return null;
  }
}

/** Route guard. Usage mirrors requireUser():
 *    const gate = await requireDirectoryAccess();
 *    if (gate.denied) return gate.denied;
 *    // gate.viewer from here on
 */
export async function requireDirectoryAccess(): Promise<
  | { viewer: DirectoryViewer; denied?: undefined }
  | { viewer?: undefined; denied: NextResponse }
> {
  const viewer = await getDirectoryViewer();
  if (!viewer) {
    return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  if (!viewer.isAdmin) {
    return { denied: NextResponse.json({ error: "Restricted" }, { status: 403 }) };
  }
  return { viewer };
}
