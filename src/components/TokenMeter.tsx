"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Copy, Check, X } from "lucide-react";

/**
 * Real token usage for a conversation, read from Hermes' session record.
 * Compact pill: in / out / total. CLICK opens a detail panel — a native
 * title tooltip vanishes the moment any key is pressed, which made it
 * impossible to screenshot. The panel also has a copy button so the raw
 * numbers can be pasted elsewhere.
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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (res.ok) setU(await res.json());
    } catch {}
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Close on outside click / Escape — but never on a plain keypress like
  // PrintScreen, so the panel survives taking a screenshot.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!u?.found) return null;

  // Billable input = uncached input + cache writes + cache reads (all sent).
  const totalIn = u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens;
  const total = totalIn + u.outputTokens;
  const cachedPct = totalIn > 0 ? Math.round((u.cacheReadTokens / totalIn) * 100) : 0;

  const rows: [string, string][] = [
    ["Uncached input (full price)", u.inputTokens.toLocaleString()],
    ["Cache read (≈10× cheaper)", `${u.cacheReadTokens.toLocaleString()} · ${cachedPct}% of input`],
    ["Cache write", u.cacheWriteTokens.toLocaleString()],
    ...(u.reasoningTokens ? ([["Reasoning", u.reasoningTokens.toLocaleString()]] as [string, string][]) : []),
    ["Output", u.outputTokens.toLocaleString()],
    ["Total sent + received", total.toLocaleString()],
    ["API calls in this session", String(u.apiCalls)],
    ...(u.costUsd != null ? ([["Estimated cost", `$${u.costUsd.toFixed(4)}`]] as [string, string][]) : []),
  ];

  const asText = rows.map(([k, v]) => `${k}: ${v}`).join("\n");

  return (
    <div ref={boxRef} className="relative min-w-0 shrink">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] min-w-0 max-w-[40vw] overflow-hidden transition-colors ${
          open ? "border-accent text-ink" : "border-line text-ink-faint hover:text-ink-soft"
        }`}
        title="Token usage — click for detail"
      >
        <Coins size={11} className="text-accent shrink-0" />
        <span className="truncate whitespace-nowrap">
          in {fmt(totalIn)} · out {fmt(u.outputTokens)} · total {fmt(total)}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-[19rem] rounded-xl border border-line bg-card p-3 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-medium">Token usage</p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(asText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="p-1 rounded hover:bg-parchment-dark text-ink-faint"
                title="Copy these numbers"
              >
                {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-parchment-dark text-ink-faint"
                title="Close"
              >
                <X size={12} />
              </button>
            </div>
          </div>
          <dl className="space-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-[11px] text-ink-faint">{k}</dt>
                <dd className="text-[11px] font-mono text-ink text-right shrink-0">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 pt-2 border-t border-line text-[10px] text-ink-faint leading-relaxed">
            Includes every API call the agent made in this session — tool loops and code execution
            included. A low cache percentage means the prompt prefix is changing between calls.
          </p>
        </div>
      )}
    </div>
  );
}
