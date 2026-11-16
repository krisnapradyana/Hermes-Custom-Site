import { readMembers } from "../members-store";
import { slackDmResult } from "../slack-notify";
import type { PipelineCard } from "./pipeline-store";

/**
 * Slack DMs for the marketing pipeline, sent as the Hermes bot. People are
 * stored on cards by display name (the Directory name), so delivery depends
 * on that member having a Slack id linked in the Directory — no link, no DM,
 * and the caller is told so.
 */

/** Public URL of the marketing sub-app, for links in messages. */
export function marketingUrl(): string {
  if (process.env.MARKETING_URL) return process.env.MARKETING_URL.replace(/\/$/, "");
  try {
    const u = new URL(process.env.AUTH_URL ?? "");
    return `${u.protocol}//marketing.${u.host}`;
  } catch {
    return "";
  }
}

export async function slackIdFor(name: string): Promise<string | null> {
  if (!name) return null;
  const m = (await readMembers()).find((x) => x.name === name);
  return m?.slackId ?? null;
}

/** DM a person by Directory name. False = not linked to Slack, or Slack refused. */
export async function dmByName(name: string, text: string): Promise<boolean> {
  const id = await slackIdFor(name);
  if (!id) return false;
  return slackDmResult(id, text);
}

const where = () => {
  const url = marketingUrl();
  return url ? `\n${url} → Content Pipeline` : "";
};

/** Fire-and-forget event notices. Never notify people about their own action. */
export function notifyReviewRequested(card: PipelineCard, by: string): void {
  if (!card.reviewer || card.reviewer === by) return;
  void dmByName(
    card.reviewer,
    `👀 *${by}* sent you a piece to review:\n• ${card.title} (${card.format})${where()}`
  );
}

export function notifyDecision(card: PipelineCard, by: string, approved: boolean, note: string): void {
  if (!card.owner || card.owner === by) return;
  const quote = note ? `\n> ${note.replace(/\n+/g, " ").slice(0, 400)}` : "";
  void dmByName(
    card.owner,
    approved
      ? `✅ *${by}* approved your piece — it is now Scheduled:\n• ${card.title}${where()}`
      : `✏️ *${by}* requested changes — it is back in Drafting:\n• ${card.title}${quote}${where()}`
  );
}

/** When this card was last nudged by hand (ms), from its thread. */
export function lastReminderAt(card: PipelineCard): number {
  for (let i = card.comments.length - 1; i >= 0; i--) {
    const m = card.comments[i];
    if (m.sys && m.text.startsWith("reminded ")) return new Date(m.at).getTime();
  }
  return 0;
}
