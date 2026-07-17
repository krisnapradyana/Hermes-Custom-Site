/**
 * Hermes gateway client — streaming.
 *
 * The proxy at /api/hermes forwards Hermes' SSE stream: OpenAI
 * chat.completion.chunk events plus Hermes' custom hermes.tool.progress
 * events. We accumulate three things:
 *   - content   — the visible answer
 *   - thinking  — <think> blocks, reasoning deltas, and tool activity lines
 * Tool calls no longer end the turn: the stream stays open until [DONE].
 */

import { Message, Attachment } from "./types";

export interface StreamState {
  content: string;
  thinking: string;
}

/** Split accumulated raw text into visible content and <think> sections. */
function splitThink(raw: string): { content: string; think: string } {
  let think = "";
  const content = raw
    .replace(/<think>([\s\S]*?)(<\/think>|$)/g, (_, inner) => {
      think += inner;
      return "";
    })
    .replace(/^\s+/, "");
  return { content, think };
}

function toolLine(data: Record<string, unknown>): string {
  const name = (data.tool ?? data.name ?? data.tool_name ?? "tool") as string;
  const status = (data.status ?? data.phase ?? "") as string;
  const detail = (data.detail ?? data.message ?? data.args ?? "") as string | object;
  const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail);
  return `⚙ ${name}${status ? ` · ${status}` : ""}${detailStr ? ` — ${detailStr.slice(0, 200)}` : ""}`;
}

export async function hermesStream(
  userMessage: string,
  history: Message[] = [],
  attachments: Attachment[] = [],
  chatId: string | undefined,
  onUpdate: (state: StreamState) => void,
  context?: string
): Promise<StreamState> {
  const finish = (content: string, thinking: string): StreamState => {
    const state = { content, thinking };
    onUpdate(state);
    return state;
  };

  try {
    const res = await fetch("/api/hermes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        history: history
          .filter((h) => h.content)
          .map((h) => ({ role: h.role, content: h.content })),
        attachments: attachments.map((a) => ({ name: a.name, type: a.type, dataUrl: a.dataUrl })),
        chatId,
        context,
      }),
    });

    const contentType = res.headers.get("content-type") ?? "";

    // Non-streaming path: JSON error or custom-mode reply.
    if (!contentType.includes("text/event-stream")) {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return finish(
          `⚠️ ${data.error ?? `Gateway error (${res.status})`}${data.detail ? `\n\n${data.detail}` : ""}`,
          ""
        );
      }
      const { content, think } = splitThink(String(data.reply ?? "(empty response)"));
      return finish(content, think);
    }

    // SSE path.
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let rawText = "";
    let reasoning = "";
    const toolLines: string[] = [];

    const emit = () => {
      const { content, think } = splitThink(rawText);
      const thinking = [toolLines.join("\n"), reasoning, think].filter(Boolean).join("\n");
      onUpdate({ content, thinking });
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join("\n");
        if (!dataStr || dataStr === "[DONE]") continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(dataStr);
        } catch {
          continue;
        }

        if (eventName.includes("tool")) {
          toolLines.push(toolLine(data));
          emit();
          continue;
        }

        // OpenAI chunk
        const choices = data.choices as
          | { delta?: { content?: string; reasoning_content?: string } }[]
          | undefined;
        const delta = choices?.[0]?.delta;
        if (delta?.reasoning_content) reasoning += delta.reasoning_content;
        if (delta?.content) rawText += delta.content;
        if (delta?.content || delta?.reasoning_content) emit();
      }
    }

    const { content, think } = splitThink(rawText);
    const thinking = [toolLines.join("\n"), reasoning, think].filter(Boolean).join("\n");
    return finish(content || "(empty response)", thinking);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return finish(`⚠️ Could not reach the Hermes proxy: ${msg}`, "");
  }
}

export interface GatewayHealth {
  configured: boolean;
  reachable: boolean;
  url?: string;
  detail?: string;
}

export async function checkGateway(): Promise<GatewayHealth> {
  try {
    const res = await fetch("/api/hermes/health", { cache: "no-store" });
    return (await res.json()) as GatewayHealth;
  } catch {
    return { configured: false, reachable: false, detail: "proxy unreachable" };
  }
}
