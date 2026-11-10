import { NextRequest, NextResponse } from "next/server";
import { isMarketingType, requireMarketingAccess } from "@/lib/marketing-access";
import { canEditDirectory, readMembers } from "@/lib/members-store";
import { readProjects } from "@/lib/projects-store";
import { RADAR_CHANNELS, RADAR_FORMATS, readRadar } from "@/lib/marketing/radar-store";
import {
  PIPELINE_STAGES,
  PUBLIC_STAGES,
  type CardInput,
  type PipelineStage,
  createCard,
  deleteCard,
  readCards,
  updateCard,
} from "@/lib/marketing/pipeline-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Content Pipeline — cards (one per angle) across five stages, each
 * optionally linked to a radar project. The radar's posting rules follow the
 * card: a piece about a Restricted project cannot be scheduled or published.
 */

/** Radar projects as link targets, with the two facts the posting rule needs. */
async function projectIndex() {
  const [projects, radar] = await Promise.all([readProjects(), readRadar()]);
  const rows = [
    ...projects.filter((p) => !!p.doneAt).map((p) => ({ id: p.id, name: p.name, color: p.color })),
    ...radar.manual.map((m) => ({ id: m.id, name: m.name, color: "#8a93a3" })),
  ];
  return rows.map((r) => {
    const e = radar.entries[r.id];
    return {
      ...r,
      nda: e?.nda ?? "ask",
      clientPublished: RADAR_CHANNELS.some((c) => e?.pub?.[c]),
    };
  });
}

export async function GET() {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const [cards, projects, members] = await Promise.all([readCards(), projectIndex(), readMembers()]);
  const people = members
    .filter((m) => isMarketingType(m.type) || canEditDirectory(m.type))
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b));

  return NextResponse.json({
    cards,
    projects,
    people,
    stages: PIPELINE_STAGES,
    formats: RADAR_FORMATS,
    me: gate.viewer.name,
  });
}

/** The one hard rule: nothing about a Restricted project goes public. */
async function blockedReason(projectId: string | undefined, stage: PipelineStage): Promise<string | null> {
  if (!projectId || !PUBLIC_STAGES.includes(stage)) return null;
  const p = (await projectIndex()).find((x) => x.id === projectId);
  if (p?.nda === "no") {
    return `"${p.name}" is marked Restricted on the Publish Radar — it cannot be scheduled or published.`;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const body = (await req.json().catch(() => null)) as CardInput | null;
  if (!body || typeof body.title !== "string" || body.title.trim().length < 2) {
    return NextResponse.json({ error: "A title is required" }, { status: 400 });
  }
  const stage = (PIPELINE_STAGES as readonly string[]).includes(body.stage as string)
    ? (body.stage as PipelineStage)
    : "Angle";
  const reason = await blockedReason(typeof body.projectId === "string" ? body.projectId : undefined, stage);
  if (reason) return NextResponse.json({ error: reason }, { status: 409 });

  const card = await createCard(body, gate.viewer.name);
  if (!card) return NextResponse.json({ error: "A title is required" }, { status: 400 });
  return NextResponse.json({ card });
}

/** Body: { id, ...fields } */
export async function PATCH(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const body = (await req.json().catch(() => null)) as ({ id?: unknown } & CardInput) | null;
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const current = (await readCards()).find((c) => c.id === body.id);
  if (!current) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  // Check the rule against the card as it WILL be after this change.
  const nextStage = (PIPELINE_STAGES as readonly string[]).includes(body.stage as string)
    ? (body.stage as PipelineStage)
    : current.stage;
  const nextProject =
    body.projectId === null || body.projectId === ""
      ? undefined
      : typeof body.projectId === "string"
        ? body.projectId
        : current.projectId;
  const reason = await blockedReason(nextProject, nextStage);
  if (reason) return NextResponse.json({ error: reason }, { status: 409 });

  const card = await updateCard(body.id, body, gate.viewer.name);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({ card });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const ok = await deleteCard(req.nextUrl.searchParams.get("id") ?? "");
  if (!ok) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
