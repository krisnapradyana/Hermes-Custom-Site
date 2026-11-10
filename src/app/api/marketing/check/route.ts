import { NextRequest, NextResponse } from "next/server";
import { requireMarketingAccess } from "@/lib/marketing-access";
import { CHECKERS, CheckerId } from "@/lib/marketing/checker-prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Checker Studio — run one of the team's review prompts over a draft.
 * One-shot through the OpenAI-compatible surface (same pattern as the brief
 * generator / post-mortem distill: no tools, no memory — text in, markdown
 * out). Nothing is stored: the review lives in the browser tab only.
 */

const API_URL = () => (process.env.HERMES_API_URL ?? "").replace(/\/$/, "");
const CHAT_URL = () => process.env.BRIEF_CHAT_URL || `${API_URL()}/v1/chat/completions`;

const MAX_DRAFT = 60_000; // chars — a very long article is ~25k
const MAX_FIELD = 2_000;

export async function POST(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  let body: { type?: string; draft?: string; context?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const checker = CHECKERS[body.type as CheckerId];
  if (!checker) return NextResponse.json({ error: "Unknown checker" }, { status: 400 });

  const draft = (body.draft ?? "").toString().trim();
  if (draft.length < 40) {
    return NextResponse.json({ error: "Paste the draft first — it is too short to review" }, { status: 400 });
  }
  if (draft.length > MAX_DRAFT) {
    return NextResponse.json({ error: "Draft is too long — review it in two parts" }, { status: 400 });
  }

  // Only the fields this checker declares, only when filled.
  const ctx = checker.fields
    .map((f) => {
      const v = (body.context?.[f.key] ?? "").toString().trim().slice(0, MAX_FIELD);
      return v ? `${f.key}: ${v}` : "";
    })
    .filter(Boolean);

  const user =
    (ctx.length ? `CONTEXT\n\n${ctx.join("\n")}\n\n` : "") +
    `${checker.draftLabel}:\n\n${draft}`;

  try {
    const res = await fetch(CHAT_URL(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.HERMES_API_KEY
          ? { authorization: `Bearer ${process.env.HERMES_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: process.env.HERMES_MODEL ?? "hermes-agent",
        messages: [
          { role: "system", content: checker.system },
          { role: "user", content: user },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(280_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Hermes answered ${res.status} — try again in a minute` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const review = data.choices?.[0]?.message?.content?.trim();
    if (!review) return NextResponse.json({ error: "Empty review — try again" }, { status: 502 });

    return NextResponse.json({
      review,
      checker: checker.id,
      label: checker.label,
      version: checker.version,
      ranAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "Hermes unreachable or timed out — try again" }, { status: 502 });
  }
}
