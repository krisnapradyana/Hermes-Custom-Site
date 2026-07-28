"use client";

import { Message } from "./types";

/**
 * Registry of in-flight conversation streams. Lives at module level, so it
 * survives page navigation within the app: leave a conversation while the
 * agent is thinking, come back, and the page re-attaches to the live stream.
 * (A full browser reload still can't resume — the stream belongs to the tab.)
 */

interface LiveStream {
  messages: Message[];
  streaming: boolean;
  listeners: Set<(m: Message[], streaming: boolean) => void>;
}

const live = new Map<string, LiveStream>();

export function beginLive(cid: string, messages: Message[]): void {
  live.set(cid, { messages, streaming: true, listeners: new Set() });
}

export function updateLive(cid: string, messages: Message[]): void {
  const s = live.get(cid);
  if (!s) return;
  s.messages = messages;
  s.listeners.forEach((l) => l(messages, true));
}

export function endLive(cid: string, messages: Message[]): void {
  const s = live.get(cid);
  if (!s) return;
  s.listeners.forEach((l) => l(messages, false));
  live.delete(cid);
}

export function getLive(cid: string): { messages: Message[]; streaming: boolean } | null {
  const s = live.get(cid);
  return s ? { messages: s.messages, streaming: s.streaming } : null;
}

export function subscribeLive(
  cid: string,
  fn: (m: Message[], streaming: boolean) => void
): () => void {
  const s = live.get(cid);
  if (!s) return () => {};
  s.listeners.add(fn);
  return () => {
    s.listeners.delete(fn);
  };
}
