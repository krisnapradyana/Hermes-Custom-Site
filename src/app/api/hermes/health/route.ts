import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gateway health check. Reports whether HERMES_API_URL is configured and
 * whether the host answers HTTP at all (any status code counts as reachable —
 * a 404 on / still means the container is up).
 */
export async function GET() {
  const url = process.env.HERMES_API_URL ?? "";

  if (!url) {
    return NextResponse.json({
      configured: false,
      reachable: false,
      detail: "HERMES_API_URL not set in .env.local",
    });
  }

  try {
    // Hermes Agent's API server exposes GET /health as a public liveness probe.
    const res = await fetch(`${url}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    return NextResponse.json({
      configured: true,
      reachable: true,
      url,
      detail: `HTTP ${res.status}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({
      configured: true,
      reachable: false,
      url,
      detail: msg,
    });
  }
}
