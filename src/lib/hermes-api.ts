/**
 * Hermes gateway client — real mode, no mock fallback.
 *
 * Calls the same-origin proxy at /api/hermes, which forwards to the Hermes
 * container configured in .env.local. Errors surface in the chat window
 * with enough detail to fix the config (wrong port, wrong path, etc).
 */

import { Message } from "./types";

export async function hermesRespond(
  userMessage: string,
  history: Message[] = []
): Promise<string> {
  try {
    const res = await fetch("/api/hermes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        history: history.map((h) => ({ role: h.role, content: h.content })),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return `⚠️ ${data.error ?? `Gateway error (${res.status})`}${
        data.detail ? `\n\n${data.detail}` : ""
      }`;
    }

    return data.reply ?? "(empty response)";
  } catch (err) {
    const msg = err instanceof Error ? err.message : "network error";
    return `⚠️ Could not reach the Hermes proxy: ${msg}`;
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
