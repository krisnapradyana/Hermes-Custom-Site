import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { readPostmortem, saveDistilled } from "@/lib/postmortem-store";
import { readProjects } from "@/lib/projects-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Distill all post-mortem responses into the project's "wisdom" doc via the
 * OpenAI-compatible one-shot surface (same pattern as the brief generator:
 * no tools, no memory — text in, markdown out). Re-runnable: a new response
 * arriving later just means pressing distill again.
 */

const API_URL = () => (process.env.HERMES_API_URL ?? "").replace(/\/$/, "");
const CHAT_URL = () => process.env.BRIEF_CHAT_URL || `${API_URL()}/v1/chat/completions`;

const SYSTEM = `You are the studio director's assistant at SuperPixel, a motion-graphics studio. You receive every team member's post-mortem reflection for one wrapped project. Distill them into the project's permanent "wisdom" document in Markdown with EXACTLY these sections:

## Repeat next time
## Warn a future team
## Plan better
## Team pulse

Rules: merge duplicate points and note how many people raised each ("(4 people)"); keep each bullet one sentence, concrete and actionable; in "Team pulse" summarize the self-ratings pattern in 2-3 sentences WITHOUT naming or ranking individuals; write so a completely new team could run a similar project from this document alone. No preamble, no closing remarks.`;

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await ctx.params;

  const doc = await readPostmortem(id);
  if (doc.responses.length === 0) {
    return NextResponse.json({ error: "No responses to distill yet" }, { status: 400 });
  }
  const project = (await readProjects()).find((p) => p.id === id);

  const body = doc.responses
    .map(
      (r, i) =>
        `### Response ${i + 1} — ${r.name} (${r.involvement})\n` +
        `Went well: ${r.wentWell}\nChallenges: ${r.challenges}\nImprove: ${r.improvements}\n` +
        `Self-ratings (1-5): perception ${r.ratings.perception}, communication ${r.ratings.communication}, speed ${r.ratings.speed}, creativity ${r.ratings.creativity}, outcome satisfaction ${r.ratings.outcome}`
    )
    .join("\n\n");

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
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Project: ${project?.name ?? id}${
              project?.startDate ? ` · ${project.startDate} → ${project.deadline ?? "?"}` : ""
            }\nResponses (${doc.responses.length}):\n\n${body}`,
          },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(110_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Hermes answered ${res.status} — try again in a minute` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const md = data.choices?.[0]?.message?.content?.trim();
    if (!md) return NextResponse.json({ error: "Empty distillation" }, { status: 502 });

    const saved = await saveDistilled(id, md);
    return NextResponse.json({ postmortem: saved });
  } catch {
    return NextResponse.json({ error: "Hermes unreachable — try again" }, { status: 502 });
  }
}
