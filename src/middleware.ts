import { auth } from "@/auth";

/**
 * Server-side auth gate for the API surface. The client-side AuthGate only
 * hides the UI — this is what actually stops unauthenticated requests.
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
  /^\/api\/internal\//, // server-to-server (Attendee UI) — routes enforce INTERNAL_TOKEN
  /^\/api\/share\//, // client share links — the long random token IS the auth
];

export default auth((req) => {
  // Single-user dev mode: no auth configured, nothing to enforce.
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") return;

  const { pathname } = req.nextUrl;
  if (PUBLIC_API.some((re) => re.test(pathname))) return;

  if (!req.auth?.user) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }
});

export const config = {
  matcher: ["/api/:path*"],
};
