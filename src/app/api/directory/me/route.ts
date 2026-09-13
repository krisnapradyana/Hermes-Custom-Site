import { NextResponse } from "next/server";
import { getDirectoryViewer } from "@/lib/directory-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who am I, and may I use the directory? The UI's single gate check —
 * answers even when NOT allowed (that's the locked screen's data).
 */
export async function GET() {
  const viewer = await getDirectoryViewer();
  if (!viewer) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({
    allowed: viewer.isAdmin,
    name: viewer.member?.name ?? viewer.name,
    type: viewer.member?.type ?? null,
    // The sidebar UserBadge shows this under the display name.
    role: viewer.member?.primaryRole ?? null,
  });
}
