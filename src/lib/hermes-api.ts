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
  /** Live one-line summary of what the agent is doing right now. */
  status?: string;
  /** ms since the last token/tool event — lets the UI flag a quiet stretch. */
  idleMs?: number;
}

/** Human-readable label for a tool the agent is running. */
const TOOL_LABELS: Record<string, string> = {
  terminal: "Running a command",
  bash: "Running a command",
  write_file: "Writing a file",
  read_file: "Reading a file",
  edit_file: "Editing a file",
  list_files: "Looking through files",
  search_files: "Searching files",
  glob: "Searching files",
  grep: "Searching file contents",
  web_search: "Searching the web",
  browser: "Browsing the web",
  fetch: "Fetching a page",
  vision_analyze: "Looking at an image",
  session_search: "Checking memory",
  memory: "Checking memory",
  slack: "Checking Slack",
  python: "Running code",
};

function statusFor(toolName: string, phase: string): string {
  const key = toolName.toLowerCase();
  const label = TOOL_LABELS[key] ?? `Using ${toolName.replace(/_/g, " ")}`;
  return phase === "completed" || phase === "complete" || phase === "done"
    ? `${label} — done`
    : label + "…";
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
  context?: string,
  projectId?: string,
  /** Abort the request — powers the Stop button. */
  signal?: AbortSignal
): Promise<StreamState> {
  const finish = (content: string, thinking: string): StreamState => {
    const state = { content, thinking };
    onUpdate(state);
    return state;
  };

  // "Sending…" until the server acknowledges the request.
  onUpdate({ content: "", thinking: "", status: "Sending…" });
  let heartbeatRef: ReturnType<typeof setInterval> | undefined;

  try {
    const res = await fetch("/api/hermes", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        history: history
          .filter((h) => h.content)
          .map((h) => ({ role: h.role, content: h.content })),
        attachments: attachments.map((a) => ({ name: a.name, type: a.type, dataUrl: a.dataUrl })),
        chatId,
        context,
        projectId,
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

    // Throttle UI updates to ~20fps. Emitting on every token forces a store
    // write + full-history re-serialize + list re-render per token, which is
    // what makes long replies feel laggy. A trailing flush (below) guarantees
    // the final, complete text is always shown.
    let lastEmit = 0;
    let status = "Thinking…"; // live one-line summary of current activity
    let lastActivity = Date.now();
    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 50) return;
      lastEmit = now;
      const { content, think } = splitThink(rawText);
      const thinking = [toolLines.join("\n"), reasoning, think].filter(Boolean).join("\n");
      onUpdate({ content, thinking, status, idleMs: now - lastActivity });
    };

    // Heartbeat: refresh the idle timer view even when nothing arrives, so the
    // UI can say "still working, quiet for Xs" instead of looking frozen.
    const heartbeat = setInterval(() => emit(true), 1000);
    heartbeatRef = heartbeat;

    let sawDone = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastActivity = Date.now();
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
        if (dataStr === "[DONE]") {
          sawDone = true;
          continue;
        }
        if (!dataStr) continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(dataStr);
        } catch {
          continue;
        }

        if (eventName.includes("tool")) {
          toolLines.push(toolLine(data));
          const name = (data.tool ?? data.name ?? data.tool_name ?? "tool") as string;
          const phase = String(data.status ?? data.phase ?? "");
          status = statusFor(name, phase);
          emit(true);
          continue;
        }

        // OpenAI chunk
        const choices = data.choices as
          { delta?: { content?: string; reasoning_content?: string } }[] | undefined;
        const delta = choices?.[0]?.delta;
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content;
          status = "Reasoning…";
        }
        if (delta?.content) {
          rawText += delta.content;
          status = "Writing the answer…";
        }
        if (delta?.content || delta?.reasoning_content) emit();
      }
    }
    clearInterval(heartbeat);

    const { content, think } = splitThink(rawText);
    const thinking = [toolLines.join("\n"), reasoning, think].filter(Boolean).join("\n");

    // Stream closed without the completion marker → treat as interrupted so
    // the UI can offer Retry instead of silently accepting a partial answer.
    if (!sawDone && !content) {
      throw new Error("The connection closed before the assistant replied.");
    }
    return finish(content || "(empty response)", thinking);
  } catch (err) {
    if (heartbeatRef) clearInterval(heartbeatRef);
    // User pressed Stop — a deliberate cancellation, not a failure.
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new StoppedError();
    }
    const msg = err instanceof Error ? err.message : "network error";
    throw new Error(msg);
  }
}

/** Thrown when the user stops a turn, so callers can render it calmly. */
export class StoppedError extends Error {
  constructor() {
    super("Stopped.");
    this.name = "StoppedError";
  }
}

/**
 * Rehydrate stored attachments (which only carry an id) back into data URLs so
 * they can be resent to the agent — used when retrying a failed turn.
 */
export async function rehydrateAttachments(list: Attachment[] = []): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const a of list) {
    if (a.dataUrl) {
      out.push(a);
      continue;
    }
    if (!a.id) continue;
    try {
      const res = await fetch(`/api/attachments/${a.id}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      out.push({ ...a, dataUrl });
    } catch {}
  }
  return out;
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
