import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserKey } from "@/lib/user-key";

export const runtime = "nodejs";

/**
 * Resolve a pending guarded-command approval — the buttons behind the
 * amber card in chat. Proxies POST /v1/runs/{run_id}/approval on the
 * Hermes API server (verified live: 200 → approval.responded → the run
 * resumes and the command executes).
 *
 * ENGINEER-GATED: only Slack ids listed in APPROVER_SLACK_IDS may resolve.
 * Everyone else gets 403 and the card shows a waiting state instead of
 * buttons. With auth disabled (local dev), everything is allowed.
 */

const API_URL = process.env.HERMES_API_URL ?? "";
const API_KEY = process.env.HERMES_API_KEY ?? "";

const CHOICES = new Set(["once", "session", "always", "deny"]);

const approvers = () =>
  (process.env.APPROVER_SLACK_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

async function currentApprover(): Promise<{ signedIn: boolean; approver: boolean }> {
  const userKey = await getUserKey();
  if (!userKey) return { signedIn: false, approver: false };
  if (userKey === "local") return { signedIn: true, approver: true }; // dev mode
  let slackId: string | undefined;
  try {
    slackId = (await auth())?.user?.slackId;
  } catch {}
  const list = approvers();
  // Empty allowlist = nobody can approve from the web (fail closed).
  return { signedIn: true, approver: !!slackId && list.includes(slackId) };
}

/** Is the signed-in user allowed to approve? Drives the card's buttons. */
export async function GET() {
  const { signedIn, approver } = await currentApprover();
  if (!signedIn) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ approver });
}

export async function POST(req: NextRequest) {
  const { signedIn, approver } = await currentApprover();
  if (!signedIn) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!approver) {
    return NextResponse.json(
      { error: "Only listed engineers can approve guarded commands" },
      { status: 403 }
    );
  }
  if (!API_URL) return NextResponse.json({ error: "HERMES_API_URL not set" }, { status: 503 });

  let body: { runId?: string; choice?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const runId = (body.runId ?? "").trim();
  const choice = (body.choice ?? "").trim();
  if (!runId || !CHOICES.has(choice)) {
    return NextResponse.json({ error: "runId and a valid choice are required" }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  try {
    const res = await fetch(`${API_URL}/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: "POST",
      headers,
      body: JSON.stringify({ choice }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: `Agent answered ${res.status}`, detail: text.slice(0, 300) },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Could not reach the agent: ${err instanceof Error ? err.message : err}` },
      { status: 504 }
    );
  }
}
