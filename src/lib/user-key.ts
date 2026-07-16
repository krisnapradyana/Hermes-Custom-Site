import { auth } from "@/auth";

/**
 * Resolves the storage/identity key for the current request.
 * - Auth enabled: requires a Slack session; key = slackId.
 * - Auth disabled (local dev): everyone shares the "local" bucket.
 * Returns null when auth is required but missing (routes should 401).
 */
export async function getUserKey(): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") return "local";
  try {
    const session = await auth();
    return session?.user?.slackId ?? null;
  } catch {
    return null;
  }
}
