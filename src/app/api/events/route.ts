import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { loadGoogleCreds, googleAccessToken, GOOGLE_API_BASE } from "@/lib/google-auth";

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

// Credentials + token exchange live in the shared lib (same token.json as
// Hermes; read-only behavior is enforced here — this route only GETs).
const API_BASE = GOOGLE_API_BASE;

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

  if (!(await loadGoogleCreds())) {
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

  const token = await googleAccessToken();
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
