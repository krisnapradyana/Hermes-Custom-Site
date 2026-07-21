import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { extractDocumentText } from "@/lib/extract-server";
import { readManifest } from "@/lib/projects-store";

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

  // Project context (working folder + folder structure manifest) rides as a
  // system message — Hermes layers it on top of its own system prompt.
  const contextParts: string[] = [];
  if (body.context) contextParts.push(body.context.slice(0, 2000));
  if (body.projectId) {
    const fc = await folderContext(body.projectId);
    if (fc) contextParts.push(fc);
  }
  const contextMessages = contextParts.length
    ? [{ role: "system" as const, content: contextParts.join("\n\n") }]
    : [];

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
