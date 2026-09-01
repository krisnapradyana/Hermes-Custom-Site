import { NextRequest, NextResponse } from "next/server";
import { findByShareToken } from "@/lib/tracker-store";
import { buildTrackerPayload } from "@/lib/tracker-service";
import { readProjects } from "@/lib/projects-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUBLIC (token-authenticated) client view of a production tracker. The
 * long random token IS the auth — middleware allowlists this path. Internal
 * details (sheet URL, share token) are stripped from the response.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const found = await findByShareToken(token);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = await buildTrackerPayload(found.projectId, found.mapping);
  if ("error" in payload) {
    return NextResponse.json({ error: "Tracker temporarily unavailable" }, { status: 502 });
  }
  const project = (await readProjects()).find((p) => p.id === found.projectId);
  // Strip internals: no sheet URL, no tab name, no share token.
  const rest = { ...payload } as Record<string, unknown>;
  delete rest.sheetUrl;
  delete rest.tab;
  return NextResponse.json({
    ...rest,
    projectName: project?.name ?? "Project",
  });
}
