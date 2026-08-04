import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/user-key";
import { hermesFetch } from "@/lib/hermes-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real token usage for one conversation, straight from Hermes' session record
 * (we send our conversation id as X-Hermes-Session-Id, so the ids match).
 * Includes every API call the agent made in that session — tool loops and
 * code execution included.
 */

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  apiCalls: number;
  costUsd: number | null;
  found: boolean;
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);

function map(s: Record<string, unknown>): Usage {
  return {
    inputTokens: num(s.input_tokens),
    outputTokens: num(s.output_tokens),
    cacheReadTokens: num(s.cache_read_tokens),
    cacheWriteTokens: num(s.cache_write_tokens),
    reasoningTokens: num(s.reasoning_tokens),
    apiCalls: num(s.api_call_count),
    costUsd:
      typeof s.actual_cost_usd === "number"
        ? s.actual_cost_usd
        : typeof s.estimated_cost_usd === "number"
          ? s.estimated_cost_usd
          : null,
    found: true,
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { sid } = await params;

  // Preferred: the single-session endpoint.
  try {
    const res = await hermesFetch(`/api/sessions/${encodeURIComponent(sid)}`);
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      const obj = (json.session ?? json.data ?? json) as Record<string, unknown>;
      if (obj && (obj.id || obj.session_id)) return NextResponse.json(map(obj));
    }
  } catch {}

  // Fallback: find it in the recent list.
  try {
    const res = await hermesFetch(`/api/sessions?limit=200`);
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      const list = (json.data ?? json.sessions ?? []) as Record<string, unknown>[];
      const hit = list.find((s) => s.id === sid || s.session_id === sid);
      if (hit) return NextResponse.json(map(hit));
    }
  } catch {}

  return NextResponse.json({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    apiCalls: 0,
    costUsd: null,
    found: false,
  } satisfies Usage);
}
