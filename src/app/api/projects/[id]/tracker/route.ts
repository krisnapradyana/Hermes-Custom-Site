import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import {
  readTrackerMapping,
  saveTrackerMapping,
  deleteTrackerMapping,
  saveTemplate,
  sheetIdFromUrl,
  TrackerMapping,
} from "@/lib/tracker-store";
import { buildTrackerPayload, invalidateTrackerCache } from "@/lib/tracker-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Production Tracker — read-only mirror of the project's client sheet.
 * GET returns the parsed canonical payload; POST saves the wizard's mapping
 * (optionally also as a reusable template); DELETE disconnects. The sheet
 * is never written. See docs/PROD-TRACKER-PLAN.md.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  const mapping = await readTrackerMapping(id);
  if (!mapping) return NextResponse.json({ connected: false });

  const payload = await buildTrackerPayload(id, mapping);
  if ("error" in payload) {
    return NextResponse.json({ connected: true, error: payload.error }, { status: payload.status });
  }
  return NextResponse.json({ ...payload, shareToken: mapping.shareToken ?? null });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  let body: Partial<TrackerMapping> & { sheetUrl?: string; saveAsTemplate?: string };
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

  // Preserve an existing share token across re-maps.
  const existing = await readTrackerMapping(id);

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
    schedule:
      body.schedule?.tab && body.schedule.tab !== "none"
        ? {
            tab: String(body.schedule.tab),
            monthRow: Math.max(1, Number(body.schedule.monthRow ?? 1)),
            weekRow: Math.max(1, Number(body.schedule.weekRow ?? 2)),
          }
        : undefined,
    shareToken: existing?.shareToken,
    savedBy: gate.person.name,
    savedAt: new Date().toISOString(),
  };
  await saveTrackerMapping(id, mapping);
  invalidateTrackerCache(id);

  if (body.saveAsTemplate?.trim()) {
    await saveTemplate({
      name: body.saveAsTemplate.trim().slice(0, 60),
      headerRows: mapping.headerRows,
      columns: mapping.columns.map((c) => ({ header: c.header, role: c.role, phase: c.phase })),
      statusDict: mapping.statusDict,
      savedAt: new Date().toISOString(),
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  await deleteTrackerMapping(id);
  invalidateTrackerCache(id);
  return NextResponse.json({ ok: true });
}
