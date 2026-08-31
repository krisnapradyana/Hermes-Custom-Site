import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Company calendar bridge — read-only Google Calendar for the Events page.
 * Auth: an OAuth refresh token for the SAME Google account the Drive/rclone
 * uses, minted once with the calendar.readonly scope (so the app cannot
 * create/edit/delete by construction). Access tokens are cached in memory;
 * event windows are cached ~60s so the whole team browsing costs almost
 * nothing in quota.
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN ?? "";
/**
 * Default credential source: the SAME files Hermes' Google access uses
 * (oauth-helper writes token.json with drive/docs/calendar/... scopes), and
 * ./documents is already mounted into this container at /workspace/documents.
 * Env vars above override when set. Read-only behavior is enforced by this
 * route (it only ever GETs), since the shared token carries write scopes.
 */
const TOKEN_FILE = process.env.GOOGLE_TOKEN_FILE ?? "/workspace/documents/token.json";
const SECRET_FILE =
  process.env.GOOGLE_CLIENT_SECRET_FILE ?? "/workspace/documents/google_client_secret.json";
// Overridable for tests.
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const API_BASE = process.env.GOOGLE_API_BASE ?? "https://www.googleapis.com";

interface Creds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

let credsCache: { at: number; creds: Creds | null } | null = null;
async function loadCreds(): Promise<Creds | null> {
  if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN) {
    return { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN };
  }
  // Re-read every minute so a re-auth via the oauth-helper is picked up.
  if (credsCache && Date.now() - credsCache.at < 60_000) return credsCache.creds;
  let creds: Creds | null = null;
  try {
    const { promises: fs } = await import("fs");
    const tok = JSON.parse(await fs.readFile(TOKEN_FILE, "utf-8")) as {
      refresh_token?: string;
      client_id?: string;
      client_secret?: string;
    };
    let clientId = tok.client_id ?? "";
    let clientSecret = tok.client_secret ?? "";
    if (!clientId || !clientSecret) {
      try {
        const sec = JSON.parse(await fs.readFile(SECRET_FILE, "utf-8")) as {
          installed?: { client_id?: string; client_secret?: string };
          web?: { client_id?: string; client_secret?: string };
        };
        const node = sec.installed ?? sec.web ?? {};
        clientId = clientId || (node.client_id ?? "");
        clientSecret = clientSecret || (node.client_secret ?? "");
      } catch {}
    }
    if (tok.refresh_token && clientId && clientSecret) {
      creds = { clientId, clientSecret, refreshToken: tok.refresh_token };
    }
  } catch {
    creds = null; // file absent/unreadable → "not connected" note
  }
  credsCache = { at: Date.now(), creds };
  return creds;
}

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string | null> {
  const creds = await loadCreds();
  if (!creds) return null;
  if (tokenCache && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`[events] token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      credsCache = null; // maybe token.json was rotated — re-read next time
      return null;
    }
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return tokenCache.token;
  } catch (err) {
    console.warn(`[events] token refresh error: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

interface CalendarOut {
  id: string;
  name: string;
  color: string;
  primary: boolean;
}
interface EventOut {
  id: string;
  calendarId: string;
  color: string;
  title: string;
  start: string; // ISO dateTime, or YYYY-MM-DD for all-day
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  meet?: string;
  recurring: boolean;
  organizer?: string;
  attendees?: { email: string; name?: string; status?: string }[];
}

// 60s window cache — the whole team can browse without hammering Google.
const winCache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  if (!(await loadCreds())) {
    return NextResponse.json({ configured: false, calendars: [], events: [] });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!Date.parse(from) || !Date.parse(to)) {
    return NextResponse.json({ error: "from/to (ISO) required" }, { status: 400 });
  }

  const key = `${from}|${to}`;
  const hit = winCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return NextResponse.json(hit.body);

  const token = await accessToken();
  if (!token) {
    return NextResponse.json(
      { error: "Could not authenticate with Google Calendar — check the token envs" },
      { status: 502 }
    );
  }
  const auth = { Authorization: `Bearer ${token}` };

  try {
    const calRes = await fetch(`${API_BASE}/calendar/v3/users/me/calendarList?minAccessRole=reader`, {
      headers: auth,
      signal: AbortSignal.timeout(10_000),
    });
    if (!calRes.ok) throw new Error(`calendarList ${calRes.status}`);
    const calJson = (await calRes.json()) as {
      items?: {
        id: string;
        summary?: string;
        summaryOverride?: string;
        backgroundColor?: string;
        primary?: boolean;
      }[];
    };
    const calendars: CalendarOut[] = (calJson.items ?? []).map((c) => ({
      id: c.id,
      name: c.summaryOverride ?? c.summary ?? c.id,
      color: c.backgroundColor ?? "#4A8CFF",
      primary: !!c.primary,
    }));

    const perCal = await Promise.all(
      calendars.map(async (c) => {
        try {
          const url =
            `${API_BASE}/calendar/v3/calendars/${encodeURIComponent(c.id)}/events` +
            `?timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}` +
            `&singleEvents=true&orderBy=startTime&maxResults=250`;
          const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return [] as EventOut[];
          const j = (await res.json()) as {
            items?: {
              id: string;
              status?: string;
              summary?: string;
              location?: string;
              description?: string;
              hangoutLink?: string;
              recurringEventId?: string;
              start?: { date?: string; dateTime?: string };
              end?: { date?: string; dateTime?: string };
              organizer?: { email?: string; displayName?: string };
              attendees?: {
                email?: string;
                displayName?: string;
                responseStatus?: string;
                resource?: boolean;
              }[];
            }[];
          };
          return (j.items ?? [])
            .filter((e) => e.status !== "cancelled" && (e.start?.date || e.start?.dateTime))
            .map<EventOut>((e) => ({
              id: `${c.id}:${e.id}`,
              calendarId: c.id,
              color: c.color,
              title: e.summary ?? "(no title)",
              start: e.start!.dateTime ?? e.start!.date!,
              end: e.end?.dateTime ?? e.end?.date ?? (e.start!.dateTime ?? e.start!.date!),
              allDay: !!e.start!.date,
              location: e.location,
              description: e.description?.slice(0, 1200),
              meet: e.hangoutLink,
              recurring: !!e.recurringEventId,
              organizer: e.organizer?.displayName ?? e.organizer?.email,
              attendees: e.attendees
                ?.filter((a) => !a.resource && a.email)
                .slice(0, 25)
                .map((a) => ({ email: a.email!, name: a.displayName, status: a.responseStatus })),
            }));
        } catch {
          return [] as EventOut[];
        }
      })
    );

    const body = { configured: true, calendars, events: perCal.flat() };
    winCache.set(key, { at: Date.now(), body });
    if (winCache.size > 24) {
      const oldest = [...winCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
      if (oldest) winCache.delete(oldest);
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: `Google Calendar error: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }
}
