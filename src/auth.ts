import NextAuth from "next-auth";
import Slack from "next-auth/providers/slack";

/**
 * Slack OIDC sign-in (Phase 1 of ROADMAP.md).
 *
 * The Slack user id ends up on `session.user.slackId` — Phase 2 will use it
 * as the Hermes memory scope (X-Hermes-Session-Key).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Slack],
  trustHost: true,
  callbacks: {
    jwt({ token, profile }) {
      if (profile) {
        token.slackId =
          (profile["https://slack.com/user_id"] as string | undefined) ??
          profile.sub ??
          undefined;
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
