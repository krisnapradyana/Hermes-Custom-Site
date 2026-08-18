import { NextResponse } from "next/server";
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

/**
 * The one auth guard for API routes. Usage:
 *
 *   const gate = await requireUser();
 *   if (gate.denied) return gate.denied;
 *   // gate.key is the user's identity from here on
 *
 * Replaces 45 hand-written copies of the same check — one definition means
 * one place to change the policy and zero chances to mistype a guard.
 */
export async function requireUser(): Promise<
  { key: string; denied?: undefined } | { key?: undefined; denied: NextResponse }
> {
  const key = await getUserKey();
  if (!key) {
    return { denied: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  return { key };
}
