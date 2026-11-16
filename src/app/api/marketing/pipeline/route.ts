import { NextRequest, NextResponse } from "next/server";
import { isMarketingType, requireMarketingAccess } from "@/lib/marketing-access";
import { canEditDirectory, readMembers } from "@/lib/members-store";
import { readProjects } from "@/lib/projects-store";
import { RADAR_CHANNELS, RADAR_FORMATS, readRadar } from "@/lib/marketing/radar-store";
import {
  BANK,
  PIPELINE_CHANNELS,
  PIPELINE_STAGES,
  PUBLIC_STAGES,
  type CardInput,
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

const validStage = (v: unknown): boolean =>
  v === BANK || (PIPELINE_STAGES as readonly string[]).includes(v as string);

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
    channels: PIPELINE_CHANNELS,
    me: gate.viewer.name,
    isLead: gate.viewer.isLead,
  });
}

/** The one hard rule: nothing about a Restricted project goes public. */
async function blockedReason(projectId: string | undefined, stage: string): Promise<string | null> {
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
  const stage = validStage(body.stage) ? (body.stage as string) : "Angle";
  const reason = await blockedReason(typeof body.projectId === "string" ? body.projectId : undefined, stage);
  if (reason) return NextResponse.json({ error: reason }, { status: 409 });

  const card = await createCard(body, gate.viewer.name);
  if (!card) return NextResponse.json({ error: "A title is required" }, { status: 400 });
  return NextResponse.json({ card });
}

/**
 * Body: { id, ...fields } to edit, or { id, action } where action is
 *   "comment"          + text
 *   "approve"          — Review → Scheduled (reviewer or leadership only)
 *   "request_changes"  + optional text — Review → Drafting (same people)
 */
export async function PATCH(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;
  const by = gate.viewer.name;

  const body = (await req.json().catch(() => null)) as
    | ({ id?: unknown; action?: unknown; text?: unknown } & CardInput)
    | null;
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const current = (await readCards()).find((c) => c.id === body.id);
  if (!current) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (body.action === "comment") {
    if (!text) return NextResponse.json({ error: "Write a comment first" }, { status: 400 });
    const card = await updateCard(current.id, {}, by, { comment: text });
    return NextResponse.json({ card });
  }

  if (body.action === "approve" || body.action === "request_changes") {
    if (current.stage !== "Review") {
      return NextResponse.json({ error: "This card is not in Review" }, { status: 409 });
    }
    // The named reviewer decides; leadership can step in. No reviewer set = open.
    const mayDecide = gate.viewer.isLead || !current.reviewer || current.reviewer === by;
    if (!mayDecide) {
      return NextResponse.json(
        { error: `Only ${current.reviewer} or leadership can approve this card` },
        { status: 403 }
      );
    }
    if (body.action === "approve") {
      const reason = await blockedReason(current.projectId, "Scheduled");
      if (reason) return NextResponse.json({ error: reason }, { status: 409 });
      const card = await updateCard(current.id, { stage: "Scheduled" }, by, {
        trail: "approved this — moved to Scheduled",
        comment: text,
      });
      return NextResponse.json({ card });
    }
    const card = await updateCard(current.id, { stage: "Drafting" }, by, {
      trail: "requested changes — moved back to Drafting",
      comment: text,
    });
    return NextResponse.json({ card });
  }

  // Plain edit. Check the posting rule against the card as it WILL be.
  const nextStage = validStage(body.stage) ? (body.stage as string) : current.stage;
  const nextProject =
    body.projectId === null || body.projectId === ""
      ? undefined
      : typeof body.projectId === "string"
        ? body.projectId
        : current.projectId;
  const reason = await blockedReason(nextProject, nextStage);
  if (reason) return NextResponse.json({ error: reason }, { status: 409 });

  const card = await updateCard(current.id, body, by);
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
