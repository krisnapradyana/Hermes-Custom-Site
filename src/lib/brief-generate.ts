import { readBrief, saveBrief } from "./briefs-store";

/**
 * Brief Generator engine. One non-streaming completion against Hermes'
 * OpenAI-compatible surface (/v1/chat/completions) — deliberately NOT the
 * chat/runs path: no tools, no approvals, no memory. Just text in, brief out.
 *
 * The prompt encodes the SuperPixel internal-brief format, distilled from the
 * team's reference brief (USS Xmas 26). The defining property of that format
 * is INTERPRETATION, not summary: production load, gates, scope traps, and
 * what the timeline actually implies.
 */

const API_URL = () => (process.env.HERMES_API_URL ?? "").replace(/\/$/, "");
const API_KEY = () => process.env.HERMES_API_KEY ?? "";
// Overridable for tests.
const CHAT_URL = () =>
  process.env.BRIEF_CHAT_URL || `${API_URL()}/v1/chat/completions`;

/** Keep the doc inside a self-hosted context window: head + tail beats blind head. */
export function capText(text: string, max = 28_000): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.75);
  const tail = max - head;
  return `${text.slice(0, head)}\n\n[… middle of document truncated …]\n\n${text.slice(-tail)}`;
}

const SYSTEM_PROMPT = `You are the senior producer at SuperPixel, a ~20-person motion graphics and animation studio. You turn client documents (SOWs, RFQs, treatment decks) into the studio's internal production brief. Your briefs are famous for being readable by a junior artist in ten minutes and for catching the traps a client document hides.

Write the brief in Markdown, in this EXACT structure:

# <EVENT/JOB NAME> — <short descriptor>
One meta line: "Internal production brief · SuperPixel · Client: <client> · <key dates> · Prepared <today>"

## 1. What this job actually is
Plain language. Short sentences. Explain the job like you would to a new team member: what the client is putting on, what exactly WE make, and the simple version of the story/content. Bold the one sentence that defines the whole scope. End the section with a one-line italic "mental model" for how to think about the work.

## 2. References to gather
If the input mentions or implies prior editions, comparable shows, or visual references, list what the team should look up (be specific about WHAT to look for in each). If none, write 2-3 lines telling the PM what references would help and why. Never invent URLs.

## 3. The deliverables — every single thing we hand over
A Markdown table listing EVERY deliverable, including optional ones. Columns: # | Name | Function | Specs/Layout | Duration | What it is like to make | Load. "What it is like to make" is a production read, not a copy of the client's words: note dependencies ("cannot start until X approved"), reuse ("assembles from item N's system"), late-arriving inputs, IP-approval exposure. Load is Low / Low-Med / Med / Med-High / High. Mark anything with missing specs as **TBC — not in brief**.

## 4. Things that stop people mis-estimating this job
2-4 short insights with bold one-line headings. The kind that changes the plan: ceilings vs targets on durations, N deliverables really being M reusable systems, hidden rounds of revisions, a deceptively heavy small item. Only insights actually supported by the document.

## 5. Who we need, and when
Markdown table: Role | What they are needed for | Shape of the engagement. Studio roles (art director, motion lead, motion artists, DOP/crew if filming, compositor, editor, playback/onsite tech, etc.) — only roles this job actually needs. Call out which role is the critical path.

## 6. Client timeline (from the document)
Markdown table: Milestone | Date, straight from the document (mark TBC where the client says so). Below the table, a bold "Read that timeline again." paragraph spelling out the implication that matters most (e.g. days between engagement and first delivery).

## 7. Blockers — what we need from the client before we can work properly
Numbered list. Missing specs, unfinalized physical/technical details, assets the client must supply, timing dependencies, and any SCOPE AMBIGUITY in the document itself (wrong headers, template carry-overs, contradictions). Bold the single biggest schedule risk and say it is the biggest.

## 8. The one line to remember
One italic line that compresses the whole job. Then: "Questions on scope, timeline or resourcing: <contact>. Do not commit dates to the client directly."

Rules:
- Never invent facts, numbers, dates, or URLs. Everything traceable to the document, clearly marked TBC when the client left it open, and flag contradictions instead of resolving them silently.
- Plain conversational language. No corporate filler ("leverage", "seamless", "comprehensive"). Short sentences win.
- Bold sparingly, for the facts someone will quote in a meeting.
- Sum durations, count deliverables, and sanity-check the client's own arithmetic — call out mismatches (e.g. per-item maxima exceeding the stated total).
- Output ONLY the Markdown brief. No preamble, no code fences.`;

export async function generateBrief(
  id: string,
  docText: string,
  opts: { contact?: string; notes?: string; sourceFile: string }
): Promise<void> {
  const rec = await readBrief(id);
  if (!rec) return;

  try {
    if (!API_URL() && !process.env.BRIEF_CHAT_URL) {
      throw new Error("HERMES_API_URL is not set");
    }
    const today = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const userPrompt = [
      `Today is ${today}.`,
      opts.contact ? `Internal contact for scope/timeline questions: ${opts.contact}.` : "",
      opts.notes ? `Extra context from the PM (trust this over guesses):\n${opts.notes}` : "",
      `\nClient document "${opts.sourceFile}" (extracted text):\n\n${capText(docText)}`,
      `\nWrite the SuperPixel internal production brief now.`,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch(CHAT_URL(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(API_KEY() ? { Authorization: `Bearer ${API_KEY()}` } : {}),
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        stream: false,
        temperature: 0.4,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      throw new Error(`Hermes answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    let md = j.choices?.[0]?.message?.content?.trim() ?? "";
    if (!md) throw new Error("Hermes returned an empty completion");
    // Models sometimes wrap output in a fence despite instructions.
    md = md.replace(/^```(?:markdown|md)?\s*\n/, "").replace(/\n```\s*$/, "");

    const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const fresh = (await readBrief(id)) ?? rec; // pick up a mid-flight attach
    fresh.markdown = md;
    if (title) fresh.title = title;
    fresh.status = "ready";
    fresh.finishedAt = new Date().toISOString();
    delete fresh.error;
    await saveBrief(fresh);
  } catch (err) {
    const fresh = (await readBrief(id)) ?? rec;
    fresh.status = "error";
    fresh.error = err instanceof Error ? err.message : String(err);
    fresh.finishedAt = new Date().toISOString();
    await saveBrief(fresh);
  }
}
