import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

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

const TEXT_EXTENSIONS = /\.(md|txt|json|csv|tsv|ts|tsx|js|jsx|py|html|css|yml|yaml|xml|sh|sql|log|env|toml|ini)$/i;

function isTextFile(a: AttachmentIn): boolean {
  return a.type.startsWith("text/") || a.type === "application/json" || TEXT_EXTENSIONS.test(a.name);
}

function decodeDataUrl(dataUrl: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Buffer.from(base64, "base64").toString("utf-8");
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildUserContent(message: string, attachments: AttachmentIn[]): string | ContentPart[] {
  const images = attachments.filter((a) => a.type.startsWith("image/"));
  const others = attachments.filter((a) => !a.type.startsWith("image/"));

  let text = message;
  for (const f of others) {
    if (isTextFile(f)) {
      const body = decodeDataUrl(f.dataUrl).slice(0, 100_000); // cap inlined size
      text += `\n\n[Attached file: ${f.name}]\n\`\`\`\n${body}\n\`\`\``;
    } else {
      text += `\n\n[Attachment "${f.name}" (${f.type}) could not be sent — the Hermes API only accepts images and text files.]`;
    }
  }

  if (images.length === 0) return text;
  return [
    { type: "text", text },
    ...images.map((img) => ({ type: "image_url" as const, image_url: { url: img.dataUrl } })),
  ];
}

export async function POST(req: NextRequest) {
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

  // Phase 2: identity + transcript scoping
  try {
    const session = await auth();
    const slackId = session?.user?.slackId;
    if (slackId) headers["X-Hermes-Session-Key"] = `${SESSION_KEY_PREFIX}${slackId}`;
  } catch {
    // auth not configured — proceed anonymously
  }
  if (body.chatId) headers["X-Hermes-Session-Id"] = body.chatId;

  const isOpenAI = MODE === "openai";
  const url = isOpenAI ? `${API_URL}/v1/chat/completions` : `${API_URL}${CHAT_PATH}`;

  const payload = isOpenAI
    ? {
        model: MODEL,
        messages: [
          ...(body.history ?? []).map((h) => ({ role: h.role, content: h.content })),
          { role: "user", content: buildUserContent(message, attachments) },
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
