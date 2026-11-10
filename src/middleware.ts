import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/auth";

/**
 * Two jobs:
 *
 * 1. Server-side auth gate for the API surface. The client-side AuthGate only
 *    hides the UI — this is what actually stops unauthenticated requests.
 *
 * 2. Subdomain routing for the Member Directory (and, identically, the
 *    Marketing platform on marketing.*): the SAME container is also
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

/** Hosts that serve one bare sub-app: every page path collapses onto it. */
const SUB_APPS: Record<string, string> = {
  "directory.": "/directory",
  "marketing.": "/marketing",
};

const apiGate = auth((req) => {
  const { pathname } = req.nextUrl;

  // Single-user dev mode: no auth configured, nothing to enforce.
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") return;

  if (PUBLIC_API.some((re) => re.test(pathname))) return;

  if (!req.auth?.user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
});

export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  const { pathname } = req.nextUrl;

  // --- Sub-app subdomains. This MUST run on the raw request, outside the
  // auth() wrapper: next-auth rewrites req.nextUrl's origin to AUTH_URL, so a
  // rewrite built from it pointed at the MAIN host — Next then proxied the
  // request out through Caddy and back in, the layout saw the main Host and
  // drew the full app shell around the sub-app. ---
  if (!pathname.startsWith("/api")) {
    const host = req.headers.get("host") ?? "";
    const prefix = Object.keys(SUB_APPS).find((p) => host.startsWith(p));
    if (!prefix) return; // pages handle auth client-side via AuthGate
    const target = SUB_APPS[prefix];
    // Tell the root layout which sub-app this is (never trust the client's copy).
    const headers = new Headers(req.headers);
    headers.set("x-spx-subapp", target.slice(1));
    if (pathname.startsWith(target)) {
      return NextResponse.next({ request: { headers } });
    }
    const url = req.nextUrl.clone();
    url.pathname = target;
    return NextResponse.rewrite(url, { request: { headers } });
  }

  // --- API auth wall. ---
  return (apiGate as unknown as (r: NextRequest, e: NextFetchEvent) => Response | Promise<Response> | undefined)(req, ev);
}

export const config = {
  // API always; pages only for host detection (skip Next internals + assets).
  matcher: ["/api/:path*", "/((?!_next/|favicon\\.ico|.*\\.(?:png|svg|ico|jpg|webp)$).*)"],
};
