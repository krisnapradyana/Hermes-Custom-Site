/**
 * Server-to-server read of the Attendee UI (timeclock) overview. Optional
 * integration: resolves to null when INTERNAL_TOKEN is unset or the clock
 * app is unreachable, so callers degrade gracefully instead of failing.
 */

export interface MemberPulse {
  userKey: string;
  name: string;
  active: { projectId: string; inAt: string } | null;
  todayMs: number;
  weekMs: number;
  lastSeen: string | null;
  weekByProject: { projectId: string; ms: number }[];
}

let cache: { at: number; members: MemberPulse[] } | null = null;
const TTL = 5_000;

export async function fetchTimeclockOverview(): Promise<MemberPulse[] | null> {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return null;
  if (cache && Date.now() - cache.at < TTL) return cache.members;

  const base = (process.env.TIMECLOCK_URL ?? "http://attendee-ui:3000").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/timeclock/overview`, {
      headers: { "x-internal-token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const members = ((await res.json()) as { members: MemberPulse[] }).members;
    cache = { at: Date.now(), members };
    return members;
  } catch {
    return null;
  }
}
