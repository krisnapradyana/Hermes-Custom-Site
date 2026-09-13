import NextAuth from "next-auth";
import Slack from "next-auth/providers/slack";

/**
 * Slack OIDC sign-in (Phase 1 of ROADMAP.md).
 *
 * The Slack user id ends up on `session.user.slackId` — Phase 2 will use it
 * as the Hermes memory scope (X-Hermes-Session-Key).
 */
/**
 * Cross-subdomain session (opt-in): with COOKIE_DOMAIN=spx-assistant.duckdns.org
 * the auth cookies carry a Domain attribute, so one sign-in on the main app is
 * also valid on directory.spx-assistant.duckdns.org (duckdns.org is on the
 * Public Suffix List, which makes spx-assistant.duckdns.org the registrable
 * domain — sharing below it is allowed). The csrf cookie must drop its
 * default __Host- prefix, because __Host- forbids Domain. HTTPS-only; leave
 * COOKIE_DOMAIN unset in local dev. Existing sessions may need one re-login.
 */
function domainCookies(domain: string) {
  const base = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: true, domain };
  return {
    sessionToken: { name: "__Secure-authjs.session-token", options: base },
    callbackUrl: { name: "__Secure-authjs.callback-url", options: { ...base, httpOnly: false } },
    csrfToken: { name: "__Secure-authjs.csrf-token", options: base },
    pkceCodeVerifier: { name: "__Secure-authjs.pkce.code_verifier", options: { ...base, maxAge: 900 } },
    state: { name: "__Secure-authjs.state", options: { ...base, maxAge: 900 } },
    nonce: { name: "__Secure-authjs.nonce", options: base },
  };
}

const cookieDomain = process.env.COOKIE_DOMAIN;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Slack],
  trustHost: true,
  ...(cookieDomain ? { cookies: domainCookies(cookieDomain) } : {}),
  callbacks: {
    /** Let post-login redirects land on sibling subdomains (directory/clock). */
    redirect({ url, baseUrl }) {
      try {
        const u = new URL(url, baseUrl);
        if (
          cookieDomain &&
          (u.hostname === cookieDomain || u.hostname.endsWith(`.${cookieDomain}`))
        ) {
          return u.toString();
        }
        if (u.origin === new URL(baseUrl).origin) return u.toString();
      } catch {
        /* malformed url — fall through to baseUrl */
      }
      return baseUrl;
    },
    /**
     * Workspace lock: only members of OUR Slack workspace may sign in.
     * Slack already blocks foreign workspaces while the app is
     * single-workspace (distribution off), but that is one toggle away
     * from changing — this check makes it OUR decision. Enforced only
     * when SLACK_TEAM_ID is set, so rollout can't lock anyone out.
     */
    signIn({ profile }) {
      const requiredTeam = process.env.SLACK_TEAM_ID;
      if (!requiredTeam) return true;
      return (profile?.["https://slack.com/team_id"] as string | undefined) === requiredTeam;
    },
    jwt({ token, profile }) {
      if (profile) {
        token.slackId =
          (profile["https://slack.com/user_id"] as string | undefined) ?? profile.sub ?? undefined;
        token.teamId = profile["https://slack.com/team_id"] as string | undefined;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.slackId = token.slackId as string | undefined;
        session.user.teamId = token.teamId as string | undefined;
      }
      return session;
    },
  },
});
