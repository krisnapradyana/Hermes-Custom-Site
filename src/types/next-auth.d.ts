import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      slackId?: string;
      teamId?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    slackId?: string;
    teamId?: string;
  }
}
