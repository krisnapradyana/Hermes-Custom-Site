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
