import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { extractDocumentText } from "@/lib/extract-server";
import { readManifest } from "@/lib/projects-store";
import { trackerPath } from "@/lib/tracker";
import { teamStatusPath } from "@/lib/team-status";

interface ManifestEntry {
  p: string;
  d: boolean;
  s?: number;
}

function fmtBytes(n?: number): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function folderContext(projectId: string): Promise<string | null> {
  const raw = await readManifest(projectId);
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as {
      root: string;
      entries: ManifestEntry[];
      fileCount: number;
      truncated: boolean;
      generatedAt: string;
    };
    const lines = m.entries
      .map((e) => (e.d ? `${e.p}/` : `${e.p}${e.s != null ? ` (${fmtBytes(e.s)})` : ""}`))
      .join("\n");
    let body = lines;
    if (body.length > 8000) body = body.slice(0, 8000) + "\n…(more)";
    return (
      `Folder structure for project folder "${m.root}" (${m.fileCount} files). ` +
      `You cannot open these files directly, but infer the project's purpose and organization ` +
      `from the names, sizes, and layout:\n${body}` +
      (m.truncated ? "\n…(list truncated)" : "")
    );
  } catch {
    return null;
  }
}

/**
 * Server-side proxy to the Hermes Agent API server.
 *
 * - openai mode: POST {API_URL}/v1/chat/completions (Hermes' native surface)
 * - custom mode: POST {API_URL}{HERMES_CHAT_PATH} with {message, history}
 *
 * Phase 2 (ROADMAP.md): when the user is signed in with Slack, we send
 *   X-Hermes-Session-Key  — stable per-user scope for long-term memory
 *   X-Hermes-Session-Id   — per-conversation transcript id
 *
 * Attachments: images are forwarded as OpenAI image_url content parts
 * (Hermes supports data: URLs); text files are inlined into the message;
 * other binary types are noted as unsupported.
 */

export const runtime = "nodejs";

const API_URL = process.env.HERMES_API_URL ?? "";
const CHAT_PATH = process.env.HERMES_CHAT_PATH ?? "/chat";
const MODE = process.env.HERMES_API_MODE ?? "custom";
const API_KEY = process.env.HERMES_API_KEY ?? "";
const MODEL = process.env.HERMES_MODEL ?? "hermes-agent";

/**
 * Runs API support (approval buttons). The /v1/chat/completions surface can
 * never deliver dangerous-command approval prompts — only the /v1/runs
 * control plane emits approval.request events and accepts
 * POST /v1/runs/{id}/approval. We feature-detect via /v1/capabilities and
 * prefer runs mode when the agent supports it; older agent images fall back
 * to the plain chat-completions path automatically.
 * Override: HERMES_RUNS_MODE=off forces the legacy path.
 */
const RUNS_MODE = process.env.HERMES_RUNS_MODE ?? "auto";

let capCache: { at: number; runs: boolean } | null = null;
async function runsSupported(headers: Record<string, string>): Promise<boolean> {
  if (RUNS_MODE === "off") return false;
  if (capCache && Date.now() - capCache.at < 5 * 60_000) return capCache.runs;
  let runs = false;
  try {
    const res = await fetch(`${API_URL}/v1/capabilities`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const cap = (await res.json()) as { features?: Record<string, boolean> };
      const f = cap.features ?? {};
      runs = !!(
        f.run_submission &&
        f.run_events_sse &&
        (f.run_approval || f.run_approval_response || f.approval_events)
      );
    }
  } catch {
    runs = false;
  }
  capCache = { at: Date.now(), runs };
  return runs;
}
// Should mirror the session-key scheme the Slack bridge uses so web + Slack
// share memory. Adjust via env if your bridge uses a different scheme.
const SESSION_KEY_PREFIX = process.env.HERMES_SESSION_KEY_PREFIX ?? "agent:main:slack:dm:";

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

interface AttachmentIn {
  name: string;
  type: string;
  dataUrl: string;
}

const TEXT_EXTENSIONS =
  /\.(md|txt|json|csv|tsv|ts|tsx|js|jsx|py|html|css|yml|yaml|xml|sh|sql|log|env|toml|ini)$/i;

function isTextFile(a: AttachmentIn): boolean {
  return (
    a.type.startsWith("text/") || a.type === "application/json" || TEXT_EXTENSIONS.test(a.name)
  );
}

function decodeDataUrl(dataUrl: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Buffer.from(base64, "base64").toString("utf-8");
}

type ContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

const DOC_CAP = 80_000; // chars of extracted text inlined per document

async function buildUserContent(
  message: string,
  attachments: AttachmentIn[]
): Promise<string | ContentPart[]> {
  const images = attachments.filter((a) => a.type.startsWith("image/"));
  const others = attachments.filter((a) => !a.type.startsWith("image/"));

  let text = message;
  for (const f of others) {
    if (isTextFile(f)) {
      const body = decodeDataUrl(f.dataUrl).slice(0, 100_000); // cap inlined size
      text += `\n\n[Attached file: ${f.name}]\n\`\`\`\n${body}\n\`\`\``;
      continue;
    }

    // Binary documents (PDF / Word / Excel): extract text server-side.
    const extracted = await extractDocumentText(f.name, f.type, dataUrlToBuffer(f.dataUrl));
    if (extracted) {
      const clipped = extracted.slice(0, DOC_CAP);
      const note = extracted.length > DOC_CAP ? "\n[…document truncated…]" : "";
      text += `\n\n[Attached document: ${f.name} — extracted text]\n\`\`\`\n${clipped}${note}\n\`\`\``;
    } else {
      text += `\n\n[Attachment "${f.name}" (${f.type}) has no extractable text — it may be a scanned/image-only document or an unsupported format. Supported: images, text files, PDF, .docx, .xlsx.]`;
    }
  }

  if (images.length === 0) return text;
  return [
    { type: "text", text },
    ...images.map((img) => ({ type: "image_url" as const, image_url: { url: img.dataUrl } })),
  ];
}

export async function POST(req: NextRequest) {
  // This route drives the paid LLM agent — it must never run unauthenticated.
  const userKey = await getUserKey();
  if (!userKey) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!API_URL) {
    return NextResponse.json(
      { error: "HERMES_API_URL is not set. Copy .env.example to .env.local and fill it in." },
      { status: 503 }
    );
  }

  let body: {
    message?: string;
    history?: HistoryItem[];
    attachments?: AttachmentIn[];
    chatId?: string;
    context?: string;
    projectId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Missing 'message'." }, { status: 400 });
  }
  const attachments = body.attachments ?? [];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  // Phase 2: identity + transcript scoping. userKey is the Slack id when
  // auth is enabled, or "local" in single-user dev mode (no scoping needed).
  if (userKey !== "local") {
    headers["X-Hermes-Session-Key"] = `${SESSION_KEY_PREFIX}${userKey}`;
  }
  if (body.chatId) headers["X-Hermes-Session-Id"] = body.chatId;

  const isOpenAI = MODE === "openai";
  const url = isOpenAI ? `${API_URL}/v1/chat/completions` : `${API_URL}${CHAT_PATH}`;

  // Project context (working folder + folder structure manifest) rides as a
  // system message — Hermes layers it on top of its own system prompt.
  const contextParts: string[] = [];
  // Constant on every call (cache-friendly): points the agent at the
  // auto-generated project index instead of relying on its tiny memory.
  contextParts.push(
    `Project index: ${trackerPath()} — read it whenever a project (current or ` +
      `past) is mentioned; it contains lookup/similarity instructions, all web ` +
      `projects (auto-generated section — never edit it), and the preserved ` +
      `"Past Projects Archive" section (you may update that section only). ` +
      `Keep your own project learnings in /opt/data/project-notes.md, not in ` +
      `persistent memory; memory is for preferences and currently-active work.`
  );
  contextParts.push(
    `Team status: ${teamStatusPath()} — auto-regenerated every few minutes; ` +
      `read it whenever asked WHO is working on something, who is standby/free ` +
      `to take work, what someone is assigned to, or about task/milestone ` +
      `deadlines and project schedules. It lists who is clocked in right now ` +
      `(and on which project), who is standby, each member's open tasks, and ` +
      `per-project schedules with unassigned tasks (good suggestions for ` +
      `standby people). Never edit this file; never copy it into memory — ` +
      `it goes stale in minutes.`
  );
  if (body.context) contextParts.push(body.context.slice(0, 2000));
  if (body.projectId) {
    const fc = await folderContext(body.projectId);
    if (fc) contextParts.push(fc);
  }
  const contextMessages = contextParts.length
    ? [{ role: "system" as const, content: contextParts.join("\n\n") }]
    : [];

  // ── Runs path: same turn, but over /v1/runs so approval prompts can
  // reach the user as events. Image turns stay on chat/completions because
  // the runs input is a plain string.
  const hasImages = attachments.some((a) => a.type.startsWith("image/"));
  if (isOpenAI && !hasImages && (await runsSupported(headers))) {
    const userText = (await buildUserContent(message, attachments)) as string;
    try {
      const created = await fetch(`${API_URL}/v1/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          input: userText,
          instructions: contextParts.join("\n\n"),
          conversation_history: (body.history ?? []).map((h) => ({
            role: h.role,
            content: h.content,
          })),
          ...(body.chatId ? { session_id: body.chatId } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!created.ok) throw new Error(`run create ${created.status}`);
      const { run_id: runId } = (await created.json()) as { run_id: string };
      if (!runId) throw new Error("no run_id in response");

      const upstream = await fetch(`${API_URL}/v1/runs/${encodeURIComponent(runId)}/events`, {
        headers: { ...headers, Accept: "text/event-stream" },
        signal: AbortSignal.timeout(600_000),
      });
      if (!upstream.ok || !upstream.body) throw new Error(`run events ${upstream.status}`);

      const enc = new TextEncoder();
      const reader = upstream.body.getReader();
      // Diagnostic: log each distinct event name once per run, so
      // `docker logs assistant-web` shows exactly what the agent emits
      // (event names vary across hermes-agent versions).
      const seenEvents = new Set<string>();
      const sniffer = new TextDecoder();
      const sniff = (chunk: Uint8Array) => {
        for (const m of sniffer.decode(chunk, { stream: true }).matchAll(/^event: (.+)$/gm)) {
          const name = m[1].trim();
          if (!seenEvents.has(name)) {
            seenEvents.add(name);
            console.log(`[hermes] run ${runId} event: ${name}`);
          }
        }
      };
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // First frame: tell the client which run this is, so the approval
          // buttons know where to POST their decision.
          controller.enqueue(enc.encode(`event: run.meta\ndata: ${JSON.stringify({ run_id: runId })}\n\n`));
        },
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            // Safety net: event names/shapes for text deltas vary across
            // agent versions. The run status endpoint carries the final
            // output — send it so the client always has the full answer
            // even if it recognized none of the streamed delta events.
            try {
              const st = await fetch(`${API_URL}/v1/runs/${encodeURIComponent(runId)}`, {
                headers,
                cache: "no-store",
                signal: AbortSignal.timeout(15_000),
              });
              if (st.ok) {
                const j = (await st.json()) as { output?: unknown; status?: string };
                if (typeof j.output === "string" && j.output) {
                  controller.enqueue(
                    enc.encode(`event: run.final\ndata: ${JSON.stringify({ output: j.output })}\n\n`)
                  );
                }
              }
            } catch {
              // stream content is all we have — proceed
            }
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          sniff(value);
          controller.enqueue(value);
        },
        cancel() {
          // Browser dropped the stream (Stop button / navigation): actually
          // stop the agent instead of letting it run headless.
          reader.cancel().catch(() => {});
          fetch(`${API_URL}/v1/runs/${encodeURIComponent(runId)}/stop`, {
            method: "POST",
            headers,
            signal: AbortSignal.timeout(10_000),
          }).catch(() => {});
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (err) {
      // Runs path failed (old image, transient error) — invalidate the
      // capability cache and fall through to the chat-completions path.
      capCache = null;
      console.warn(
        `[hermes] runs path failed, falling back to chat/completions: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  const payload = isOpenAI
    ? {
        model: MODEL,
        messages: [
          ...contextMessages,
          ...(body.history ?? []).map((h) => ({ role: h.role, content: h.content })),
          { role: "user", content: await buildUserContent(message, attachments) },
        ],
        stream: true,
      }
    : { message, history: body.history ?? [] };

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      // Long ceiling: agent turns with tool use can run for minutes.
      signal: AbortSignal.timeout(600_000),
    });

    // Pass the SSE stream straight through to the browser.
    const upstreamType = upstream.headers.get("content-type") ?? "";
    if (upstream.ok && upstreamType.includes("text/event-stream") && upstream.body) {
      return new Response(upstream.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Hermes returned ${upstream.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      );
    }

    let reply = text;
    try {
      const json = JSON.parse(text);
      reply =
        json.choices?.[0]?.message?.content ??
        json.reply ??
        json.response ??
        json.message ??
        json.content ??
        text;
    } catch {}

    return NextResponse.json({ reply: String(reply) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Could not reach Hermes at ${url}: ${msg}` },
      { status: 504 }
    );
  }
}
