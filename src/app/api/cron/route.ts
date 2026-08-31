import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireUser } from "@/lib/user-key";
import { passthrough } from "@/lib/hermes-admin";
import { openDmChannel } from "@/lib/slack-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  return passthrough("/api/jobs");
}

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Web-created jobs get an api_server origin, which delivers nowhere. When
  // asked, resolve the creator's Slack DM and set an explicit delivery
  // target ("slack:<channel>") so Hermes posts the result natively — no
  // credential-touching prompts needed.
  if (body.deliverSlackDm) {
    delete body.deliverSlackDm;
    let session;
    try {
      session = await auth();
    } catch {}
    const slackId = session?.user?.slackId;
    const dm = slackId ? await openDmChannel(slackId) : null;
    if (!dm) {
      return NextResponse.json(
        { error: "Couldn't open your Slack DM — is SLACK_BOT_TOKEN configured?" },
        { status: 502 }
      );
    }
    body.deliver = `slack:${dm}`;
  }

  return passthrough("/api/jobs", { method: "POST", body: JSON.stringify(body) });
}
