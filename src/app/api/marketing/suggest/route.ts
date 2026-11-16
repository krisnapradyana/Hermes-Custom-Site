import { NextRequest, NextResponse } from "next/server";
import { requireMarketingAccess } from "@/lib/marketing-access";
import { readProjects } from "@/lib/projects-store";
import { EMPTY_ENTRY, RADAR_FORMATS, STANDARD_DELIVERABLES, readRadar } from "@/lib/marketing/radar-store";
import { readCards } from "@/lib/marketing/pipeline-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Content suggestions for one radar project — a one-shot Hermes call (no
 * tools, no memory) over the project's master record. Returns ideas only;
 * nothing is saved until a person adds one to the content bank.
 */

const API_URL = () => (process.env.HERMES_API_URL ?? "").replace(/\/$/, "");
const CHAT_URL = () => process.env.BRIEF_CHAT_URL || `${API_URL()}/v1/chat/completions`;

const SYSTEM = `You help the marketing team of SuperPixel, an animation-led studio, plan content about a finished project.

You receive the project's record. Propose content pieces the team could make from it.

Rules:
- One piece = one angle: a concrete scene, decision or lesson from the project — not a description of the project.
- Use ONLY facts in the record. Never invent numbers, results, quotes, client reactions or details. If the record is thin, propose fewer pieces and keep them general.
- Plain words. No hype: never "seamless", "unforgettable", "cutting-edge", "captivating", "boost engagement", "go viral".
- SuperPixel is an animation studio first; technology is a delivery layer.
- Do not repeat a piece that already exists.
- Prefer the formats listed as still missing.

Answer with ONLY a JSON array, no prose, no code fence. 3 to 5 items, each:
{"format": "<one of the allowed formats, exactly>", "title": "<the angle as a working title, max 90 characters>", "why": "<one sentence: why this angle suits this format>"}`;

interface Suggestion {
  format: string;
  title: string;
  why: string;
}

/** Models sometimes wrap JSON in a fence or a sentence — take the outermost array. */
function parseSuggestions(raw: string): Suggestion[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const allowed = RADAR_FORMATS as readonly string[];
  return arr
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const format = typeof o.format === "string" ? o.format.trim() : "";
      const title = typeof o.title === "string" ? o.title.trim().slice(0, 160) : "";
      const why = typeof o.why === "string" ? o.why.trim().slice(0, 300) : "";
      return allowed.includes(format) && title.length > 3 ? { format, title, why } : null;
    })
    .filter((s): s is Suggestion => s !== null)
    .slice(0, 6);
}

export async function POST(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const body = (await req.json().catch(() => null)) as { projectId?: unknown } | null;
  const id = typeof body?.projectId === "string" ? body.projectId : "";
  const [projects, radar, cards] = await Promise.all([readProjects(), readRadar(), readCards()]);
  const tracked = projects.find((p) => p.id === id && !!p.doneAt);
  const manual = radar.manual.find((m) => m.id === id);
  if (!tracked && !manual) return NextResponse.json({ error: "Unknown project" }, { status: 404 });

  const e = { ...EMPTY_ENTRY, ...(radar.entries[id] ?? {}) };
  if (e.nda === "no") {
    return NextResponse.json(
      { error: "This project is Restricted — no content can be planned for it" },
      { status: 409 }
    );
  }

  const name = tracked?.name ?? manual?.name ?? "";
  const existing = cards.filter((c) => c.projectId === id);
  const missing = STANDARD_DELIVERABLES.filter((f) => !e.skip.includes(f) && !existing.some((c) => c.format === f));
  const line = (label: string, v: string) => (v ? `${label}: ${v}` : "");
  const record = [
    `Project: ${name}`,
    line("Tracker description", (tracked?.description ?? manual?.client ?? "").replace(/\s+/g, " ").slice(0, 600)),
    line("Summary", e.summary),
    line("Challenge", e.challenge),
    line("Our contribution", e.contribution),
    line("Services", e.services.join(", ")),
    line("Angle already noted", e.angle),
    `Allowed formats: ${RADAR_FORMATS.join(", ")}`,
    `Formats still missing: ${missing.join(", ") || "none"}`,
    existing.length
      ? `Pieces that already exist:\n${existing.map((c) => `- ${c.format}: ${c.title}`).join("\n")}`
      : "Pieces that already exist: none",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch(CHAT_URL(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.HERMES_API_KEY ? { authorization: `Bearer ${process.env.HERMES_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: process.env.HERMES_MODEL ?? "hermes-agent",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: record },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(170_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Hermes answered ${res.status} — try again in a minute` }, { status: 502 });
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const suggestions = parseSuggestions(data.choices?.[0]?.message?.content ?? "");
    if (!suggestions.length) {
      return NextResponse.json({ error: "No usable suggestions came back — try again" }, { status: 502 });
    }
    // Thin record = generic ideas; say so rather than let them look grounded.
    const thin = !e.summary && !e.challenge && !e.contribution;
    return NextResponse.json({ suggestions, thin });
  } catch {
    return NextResponse.json({ error: "Hermes unreachable or timed out — try again" }, { status: 502 });
  }
}
