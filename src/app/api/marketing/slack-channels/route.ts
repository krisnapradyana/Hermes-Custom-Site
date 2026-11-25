import { NextResponse } from "next/server";
import { requireMarketingAccess } from "@/lib/marketing-access";
import { listBotChannels } from "@/lib/slack-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Channels "Share to Slack" can post to: the ones the Hermes bot is a member
 * of. Each project gets its own channel, so this list is the picker — a
 * channel missing from it needs the bot invited first.
 */
export async function GET() {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;
  return NextResponse.json({ channels: await listBotChannels() });
}
