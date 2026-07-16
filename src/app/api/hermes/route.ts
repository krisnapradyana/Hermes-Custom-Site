import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy to the Hermes gateway.
 *
 * The browser calls this route (same-origin, no CORS); this route forwards
 * to the Hermes container using env config. Any API key stays on the server.
 *
 * Configure via .env.local — see .env.example.
 */

export const runtime = "nodejs";

const API_URL = process.env.HERMES_API_URL ?? "";
const CHAT_PATH = process.env.HERMES_CHAT_PATH ?? "/chat";
const MODE = process.env.HERMES_API_MODE ?? "custom"; // "openai" | "custom"
const API_KEY = process.env.HERMES_API_KEY ?? "";
const MODEL = process.env.HERMES_MODEL ?? "hermes";

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  if (!API_URL) {
    return NextResponse.json(
      { error: "HERMES_API_URL is not set. Copy .env.example to .env.local and fill it in." },
      { status: 503 }
    );
  }

  let body: { message?: string; history?: HistoryItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Missing 'message'." }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const isOpenAI = MODE === "openai";
  const url = isOpenAI ? `${API_URL}/v1/chat/completions` : `${API_URL}${CHAT_PATH}`;

  const payload = isOpenAI
    ? {
        model: MODEL,
        messages: [
          ...(body.history ?? []).map((h) => ({ role: h.role, content: h.content })),
          { role: "user", content: message },
        ],
        stream: false,
      }
    : { message, history: body.history ?? [] };

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Hermes returned ${upstream.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      );
    }

    // Parse a reply out of whatever shape Hermes returned.
    let reply = text;
    try {
      const json = JSON.parse(text);
      reply =
        json.choices?.[0]?.message?.content ?? // OpenAI shape
        json.reply ??
        json.response ??
        json.message ??
        json.content ??
        text;
    } catch {
      // Non-JSON response — return the raw text.
    }

    return NextResponse.json({ reply: String(reply) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Could not reach Hermes at ${url}: ${msg}` },
      { status: 504 }
    );
  }
}
