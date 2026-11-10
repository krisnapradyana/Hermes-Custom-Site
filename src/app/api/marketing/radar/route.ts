import { NextRequest, NextResponse } from "next/server";
import { requireMarketingAccess } from "@/lib/marketing-access";
import { readProjects } from "@/lib/projects-store";
import {
  EMPTY_ENTRY,
  type RadarPatch,
  RADAR_CHANNELS,
  RADAR_FORMATS,
  addManual,
  patchEntry,
  readRadar,
  removeManual,
} from "@/lib/marketing/radar-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publish Radar — delivered projects (live from the tracker: anything marked
 * done) + hand-added ones, each merged with marketing's manual record:
 * where the client has published, NDA status, angle, planned content.
 */

export async function GET() {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const [projects, radar] = await Promise.all([readProjects(), readRadar()]);

  const tracker = projects
    .filter((p) => !!p.doneAt)
    .map((p) => ({
      id: p.id,
      source: "tracker" as const,
      name: p.name,
      sub: (p.description ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
      color: p.color,
      deliveredAt: (p.doneAt as string).slice(0, 10),
    }));
  const manual = radar.manual.map((m) => ({
    id: m.id,
    source: "manual" as const,
    name: m.name,
    sub: m.client,
    color: "#8a93a3",
    deliveredAt: m.deliveredAt ?? null,
  }));

  const items = [...tracker, ...manual]
    .map((it) => ({ ...it, ...EMPTY_ENTRY, ...(radar.entries[it.id] ?? {}) }))
    .sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""));

  return NextResponse.json({ items, channels: RADAR_CHANNELS, formats: RADAR_FORMATS });
}

/** Update one project's radar record. Body: { id, ...fields } */
export async function PATCH(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const body = (await req.json().catch(() => null)) as ({ id?: string } & Record<string, unknown>) | null;
  const id = body?.id;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  // The id must be a real radar row — never create records for unknown ids.
  const [projects, radar] = await Promise.all([readProjects(), readRadar()]);
  const known =
    projects.some((p) => p.id === id && !!p.doneAt) || radar.manual.some((m) => m.id === id);
  if (!known) return NextResponse.json({ error: "Unknown project" }, { status: 404 });

  const entry = await patchEntry(id, body as RadarPatch, gate.viewer.name);
  return NextResponse.json({ entry });
}

/** Add a project the tracker doesn't know. Body: { name, client?, deliveredAt? } */
export async function POST(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const body = (await req.json().catch(() => null)) as
    | { name?: string; client?: string; deliveredAt?: string }
    | null;
  const name = (body?.name ?? "").toString().trim();
  if (name.length < 2) return NextResponse.json({ error: "Project name is required" }, { status: 400 });

  const project = await addManual(
    { name, client: body?.client?.toString(), deliveredAt: body?.deliveredAt?.toString() },
    gate.viewer.name
  );
  return NextResponse.json({ project });
}

/** Remove a hand-added project (?id=). Tracker projects can only be hidden. */
export async function DELETE(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const ok = await removeManual(id);
  if (!ok) return NextResponse.json({ error: "Only hand-added projects can be removed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
