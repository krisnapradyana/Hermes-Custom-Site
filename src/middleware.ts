import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Two jobs:
 *
 * 1. Server-side auth gate for the API surface. The client-side AuthGate only
 *    hides the UI — this is what actually stops unauthenticated requests.
 *
 * 2. Subdomain routing for the Member Directory: the SAME container is also
 *    reached as directory.spx-assistant.duckdns.org (Caddy proxies both hosts
 *    here), and on that host every page path rewrites to /directory — the
 *    clock's hosting pattern without a second app. API paths are left alone
 *    so auth + directory endpoints work on the subdomain too.
 *
 * Public by design:
 *   /api/auth/*          — the sign-in flow itself
 *   /api/hermes/health   — pre-login status dot (response is sanitized)
 *
 * Every route still runs its own getUserKey() check — this middleware is the
 * outer wall, not a replacement for those.
 */

const PUBLIC_API = [
  /^\/api\/auth(\/|$)/,
  /^\/api\/hermes\/health$/,
  /^\/api\/server-status$/, // coarse load level for the status bar (pre-login too)
  /^\/api\/version$/, // deploy beacon — stale tabs must see it even with a dead session
  /^\/api\/internal\//, // server-to-server (Attendee UI, Hermes) — routes enforce INTERNAL_TOKEN
  /^\/api\/share\//, // client share links — the long random token IS the auth
];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // --- Directory subdomain: pages collapse onto the directory screen. ---
  const host = req.headers.get("host") ?? "";
  if (host.startsWith("directory.") && !pathname.startsWith("/api")) {
    if (!pathname.startsWith("/directory")) {
      const url = req.nextUrl.clone();
      url.pathname = "/directory";
      return NextResponse.rewrite(url);
    }
    return; // already the directory page
  }

  // --- API auth wall (pages handle auth client-side via AuthGate). ---
  if (!pathname.startsWith("/api")) return;

  // Single-user dev mode: no auth configured, nothing to enforce.
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") return;

  if (PUBLIC_API.some((re) => re.test(pathname))) return;

  if (!req.auth?.user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
});

export const config = {
  // API always; pages only for host detection (skip Next internals + assets).
  matcher: ["/api/:path*", "/((?!_next/|favicon\\.ico|.*\\.(?:png|svg|ico|jpg|webp)$).*)"],
};
