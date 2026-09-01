import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { googleAccessToken, GOOGLE_SHEETS_BASE } from "@/lib/google-auth";
import {
  readTrackerMapping,
  saveTrackerMapping,
  deleteTrackerMapping,
  sheetIdFromUrl,
  TrackerMapping,
} from "@/lib/tracker-store";
import { parseTracker, validateMapping } from "@/lib/tracker-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Production Tracker — read-only mirror of the project's client sheet.
 * GET returns the parsed canonical payload; POST saves the wizard's mapping;
 * DELETE disconnects. The sheet is never written. See
 * docs/PROD-TRACKER-PLAN.md.
 */

async function fetchValues(
  sheetId: string,
  tab: string
): Promise<{ values: string[][] } | { error: string; status: number }> {
  const token = await googleAccessToken();
  if (!token) return { error: "Google credentials unavailable (documents/token.json)", status: 502 };
  const url =
    `${GOOGLE_SHEETS_BASE}/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/` +
    `${encodeURIComponent(`'${tab.replace(/'/g, "''")}'`)}?majorDimension=ROWS`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    return { error: `Sheets API answered ${res.status}`, status: 502 };
  }
  const j = (await res.json()) as { values?: string[][] };
  return { values: j.values ?? [] };
}

// 60s cache per project — the whole team can stare at it for free.
const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  const mapping = await readTrackerMapping(id);
  if (!mapping) return NextResponse.json({ connected: false });

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return NextResponse.json(hit.body);

  const fetched = await fetchValues(mapping.sheetId, mapping.tab);
  if ("error" in fetched) {
    return NextResponse.json({ connected: true, error: fetched.error }, { status: fetched.status });
  }

  // Restructured sheet → honest degraded state, never misaligned data.
  const check = validateMapping(mapping, fetched.values);
  if (!check.ok) {
    const body = {
      connected: true,
      broken: true,
      missing: check.missing,
      sheetUrl: mapping.sheetUrl,
      tab: mapping.tab,
    };
    return NextResponse.json(body);
  }

  const parsed = parseTracker(mapping, fetched.values);
  const body = {
    connected: true,
    broken: false,
    sheetUrl: mapping.sheetUrl,
    tab: mapping.tab,
    syncedAt: new Date().toISOString(),
    ...parsed,
  };
  cache.set(id, { at: Date.now(), body });
  return NextResponse.json(body);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  let body: Partial<TrackerMapping> & { sheetUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const sheetId = sheetIdFromUrl(body.sheetUrl ?? "");
  if (!sheetId) return NextResponse.json({ error: "Not a Google Sheets URL" }, { status: 400 });
  if (!body.tab || !Array.isArray(body.columns) || !body.columns.length) {
    return NextResponse.json({ error: "tab and columns are required" }, { status: 400 });
  }
  if (!body.columns.some((c) => c.role === "phaseStatus")) {
    return NextResponse.json({ error: "Map at least one phase status column" }, { status: 400 });
  }
  if (!body.columns.some((c) => c.role === "shotId" || c.role === "scene")) {
    return NextResponse.json({ error: "Map a Shot ID or Scene column" }, { status: 400 });
  }

  const mapping: TrackerMapping = {
    sheetId,
    sheetUrl: body.sheetUrl!,
    tab: body.tab,
    headerRows: Math.min(5, Math.max(1, Number(body.headerRows ?? 1))),
    columns: body.columns.map((c) => ({
      index: Number(c.index),
      header: String(c.header ?? ""),
      role: c.role,
      phase: c.phase ? String(c.phase) : undefined,
    })),
    statusDict: Object.fromEntries(
      Object.entries(body.statusDict ?? {}).map(([k, v]) => [k.trim().toLowerCase(), v])
    ) as TrackerMapping["statusDict"],
    savedBy: gate.person.name,
    savedAt: new Date().toISOString(),
  };
  await saveTrackerMapping(id, mapping);
  cache.delete(id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  await deleteTrackerMapping(id);
  cache.delete(id);
  return NextResponse.json({ ok: true });
}
