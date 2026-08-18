import { NextRequest, NextResponse } from "next/server";
import { readProjects } from "@/lib/projects-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-to-server project list for the Attendee UI (timeclock app) — this
 * app stays the single writer of projects.json; siblings read over HTTP.
 * Guarded by a shared token, never by session: the caller is a container,
 * not a person. 404 when the token isn't configured, so the route is
 * invisible unless the integration is actually set up.
 */
export async function GET(req: NextRequest) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const projects = (await readProjects()).map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
  }));
  return NextResponse.json({ projects });
}
