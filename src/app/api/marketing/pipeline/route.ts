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
  pendingReviewers,
  readCards,
  updateCard,
} from "@/lib/marketing/pipeline-store";

import {
  dmByName,
  lastReminderAt,
  marketingUrl,
  notifyDecision,
  notifyReviewRequested,
  slackIdFor,
} from "@/lib/marketing/notify";
import { listBotChannels, slackPost } from "@/lib/slack-notify";

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
    ...projects
      .filter((p) => !!p.doneAt)
      // slackChannel: the project's own channel — the default for "Share to Slack".
      .map((p) => ({ id: p.id, name: p.name, color: p.color, slackChannel: p.slackChannel ?? "" })),
    ...radar.manual.map((m) => ({ id: m.id, name: m.name, color: "#8a93a3", slackChannel: "" })),
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
 *   "approve"          — records this approver; when ALL approvers have
 *                        approved the card moves Review → Scheduled
 *   "request_changes"  + optional text — Review → Drafting, approvals cleared
 *   "remind"           — Slack DM to the approvers who have not approved yet
 *   "share"            + channel (id), optional text — post an update to a
 *                        Slack channel the bot is in, mentioning owner + approvers
 * Sending for review, the final approval and change requests also DM the
 * person who has to act next, when they are linked to Slack.
 */
export async function PATCH(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;
  const by = gate.viewer.name;

  const body = (await req.json().catch(() => null)) as
    | ({ id?: unknown; action?: unknown; text?: unknown; channel?: unknown } & CardInput)
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

  if (body.action === "share") {
    const channelId = typeof body.channel === "string" ? body.channel : "";
    // Only channels the bot is actually in — never an id taken on trust.
    const channel = (await listBotChannels()).find((c) => c.id === channelId);
    if (!channel) {
      return NextResponse.json(
        { error: "Pick a channel the Hermes bot is a member of" },
        { status: 400 }
      );
    }
    const people = Array.from(new Set([current.owner, ...current.reviewers].filter((n) => n && n !== by)));
    const ids = (await Promise.all(people.map(slackIdFor))).filter((x): x is string => !!x);
    const url = marketingUrl();
    const note = text ? `\n> ${text.replace(/\n+/g, " ").slice(0, 600)}` : "";
    const sent = await slackPost(
      channel.id,
      `📣 *${by}* shared an update on *${current.title}* (${current.format} · ${
        current.stage === "Bank" ? "content bank" : current.stage
      })${note}${ids.length ? `\ncc ${ids.map((i) => `<@${i}>`).join(" ")}` : ""}${
        url ? `\n${url} → Content Pipeline` : ""
      }`
    );
    if (!sent) {
      return NextResponse.json({ error: `Slack refused the post to #${channel.name}` }, { status: 502 });
    }
    const card = await updateCard(current.id, {}, by, { trail: `shared this to #${channel.name} on Slack` });
    return NextResponse.json({ card });
  }

  if (body.action === "remind") {
    const pending = pendingReviewers(current).filter((n) => n !== by);
    if (current.stage !== "Review" || pending.length === 0) {
      return NextResponse.json(
        { error: "There is nobody to remind — the card is not waiting on another approver" },
        { status: 409 }
      );
    }
    // One nudge per card per 12 hours — a reminder, not a siren.
    if (Date.now() - lastReminderAt(current) < 12 * 3_600_000) {
      return NextResponse.json({ error: "A reminder for this card was already sent today" }, { status: 409 });
    }
    const url = marketingUrl();
    const results = await Promise.all(
      pending.map(async (name) => ({
        name,
        ok: await dmByName(
          name,
          `⏰ *${by}* is waiting for your approval:\n• ${current.title} (${current.format})${
            url ? `\n${url} → Content Pipeline → Review` : ""
          }`
        ),
      }))
    );
    const reached = results.filter((r) => r.ok).map((r) => r.name);
    if (!reached.length) {
      return NextResponse.json(
        { error: `Could not reach ${pending.join(", ")} on Slack — check their Slack link in the Directory` },
        { status: 409 }
      );
    }
    const card = await updateCard(current.id, {}, by, { trail: `reminded ${reached.join(", ")} on Slack` });
    return NextResponse.json({ card });
  }

  if (body.action === "approve" || body.action === "request_changes") {
    if (current.stage !== "Review") {
      return NextResponse.json({ error: "This card is not in Review" }, { status: 409 });
    }
    // The named approvers decide; leadership can step in. No approver set = open.
    const listed = current.reviewers.includes(by);
    const mayDecide = gate.viewer.isLead || current.reviewers.length === 0 || listed;
    if (!mayDecide) {
      return NextResponse.json(
        { error: `Only ${current.reviewers.join(", ")} or leadership can approve this card` },
        { status: 403 }
      );
    }
    if (body.action === "request_changes") {
      const card = await updateCard(current.id, { stage: "Drafting" }, by, {
        trail: "requested changes — moved back to Drafting",
        comment: text,
        clearApprovals: true,
      });
      if (card) notifyDecision(card, by, false, text);
      return NextResponse.json({ card });
    }

    if (listed && current.approvals.some((a) => a.by === by)) {
      return NextResponse.json({ error: "You have already approved this card" }, { status: 409 });
    }
    // Who is still missing once this approval lands. Someone outside the
    // list (leadership stepping in, or no approvers set) settles it outright.
    const still = listed ? pendingReviewers(current).filter((n) => n !== by) : [];
    if (still.length > 0) {
      const done = current.reviewers.length - still.length;
      const card = await updateCard(current.id, {}, by, {
        trail: `approved this (${done} of ${current.reviewers.length}) — waiting for ${still.join(", ")}`,
        comment: text,
        approve: true,
      });
      return NextResponse.json({ card });
    }
    const reason = await blockedReason(current.projectId, "Scheduled");
    if (reason) return NextResponse.json({ error: reason }, { status: 409 });
    const card = await updateCard(current.id, { stage: "Scheduled" }, by, {
      trail: "approved this — moved to Scheduled",
      comment: text,
      approve: listed,
    });
    if (card) notifyDecision(card, by, true, text);
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
  // Tell the reviewer when a piece lands on them: it entered Review, or the
  // reviewer changed while it was already there.
  if (card.stage === "Review") {
    if (current.stage !== "Review") notifyReviewRequested(card, by);
    else {
      const added = card.reviewers.filter((r) => !current.reviewers.includes(r));
      if (added.length) notifyReviewRequested(card, by, added);
    }
  }
  return NextResponse.json({ card });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const ok = await deleteCard(req.nextUrl.searchParams.get("id") ?? "");
  if (!ok) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
