"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins } from "lucide-react";

/**
 * Real token usage for a conversation, read from Hermes' session record.
 * Compact display: in / out / total. Hover for cache + cost detail.
 */

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  apiCalls: number;
  costUsd: number | null;
  found: boolean;
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export function TokenMeter({ sessionId, refreshKey }: { sessionId: string; refreshKey?: unknown }) {
  const [u, setU] = useState<Usage | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (res.ok) setU(await res.json());
    } catch {}
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!u?.found) return null;

  // Billable input = uncached input + cache writes + cache reads (all sent).
  const totalIn = u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens;
  const total = totalIn + u.outputTokens;
  const cachedPct = totalIn > 0 ? Math.round((u.cacheReadTokens / totalIn) * 100) : 0;

  const tip = [
    `Uncached input: ${u.inputTokens.toLocaleString()}`,
    `Cache read (≈10× cheaper): ${u.cacheReadTokens.toLocaleString()} (${cachedPct}% of input)`,
    `Cache write: ${u.cacheWriteTokens.toLocaleString()}`,
    u.reasoningTokens ? `Reasoning: ${u.reasoningTokens.toLocaleString()}` : null,
    `Output: ${u.outputTokens.toLocaleString()}`,
    `API calls: ${u.apiCalls}`,
    u.costUsd != null ? `Est. cost: $${u.costUsd.toFixed(4)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      title={tip}
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-faint cursor-help min-w-0 max-w-[40vw] overflow-hidden"
    >
      <Coins size={11} className="text-accent shrink-0" />
      <span className="truncate whitespace-nowrap">
        in {fmt(totalIn)} · out {fmt(u.outputTokens)} · total {fmt(total)}
      </span>
    </span>
  );
}
