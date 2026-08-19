import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";

export const runtime = "nodejs";

/**
 * Resolve a pending agent approval — the button behind "The command is
 * waiting for your approval". Proxies POST /v1/runs/{run_id}/approval on the
 * Hermes API server. Choices: once | session | always | deny.
 */

const API_URL = process.env.HERMES_API_URL ?? "";
const API_KEY = process.env.HERMES_API_KEY ?? "";

const CHOICES = new Set(["once", "session", "always", "deny"]);

export async function POST(req: NextRequest) {
  const userKey = await getUserKey();
  if (!userKey) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
