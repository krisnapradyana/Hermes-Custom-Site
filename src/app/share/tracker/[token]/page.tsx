"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";

/**
 * PUBLIC client view of a production tracker — reached only via the long
 * random share token. Bare page (no sidebar, no sign-in), read-only, and
 * stripped of internal details server-side.
 */

type Bucket = "todo" | "in_progress" | "waiting_client" | "revise" | "approved" | "unknown";
interface PhaseCell {
  statusRaw: string;
  status: Bucket;
  assignee?: string;
}
interface Shot {
  rowIndex: number;
  scene?: string;
  shotId: string;
  type?: string;
  complexity?: string;
  batch?: string;
  phases: Record<string, PhaseCell>;
}
interface Payload {
  projectName: string;
  syncedAt?: string;
  broken?: boolean;
  phases?: string[];
  shots?: Shot[];
  stats?: {
    phases: { name: string; counts: Record<Bucket, number>; approvedPct: number }[];
    shotCount: number;
    batches: string[];
  };
}

const CHIP: Record<Bucket, string> = {
  todo: "bg-parchment-dark text-ink-soft",
  in_progress: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  waiting_client: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  revise: "bg-red-500/15 text-red-500",
  approved: "bg-green-500/15 text-green-600 dark:text-green-400",
  unknown: "border border-dashed border-ink-faint text-ink-faint",
};

export default function ShareTrackerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [batch, setBatch] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/share/tracker/${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(res.status === 404 ? "This link is no longer valid." : "Temporarily unavailable.");
        return;
      }
      setData((await res.json()) as Payload);
      setError("");
    } catch {
      setError("Temporarily unavailable.");
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 120_000);
    return () => clearInterval(t);
  }, [load]);

  const shots = useMemo(() => {
    const all = data?.shots ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((s) => {
      if (batch && s.batch !== batch) return false;
      if (needle && !`${s.shotId} ${s.scene ?? ""} ${s.type ?? ""}`.toLowerCase().includes(needle))
        return false;
      return true;
    });
  }, [data, q, batch]);

  const phases = data?.phases ?? [];

  return (
    <div className="min-h-screen bg-parchment text-ink">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Brand header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center text-white font-medium text-sm">
            SP
          </div>
          <div>
            <h1 className="font-serif-display text-2xl leading-tight">
              {data?.projectName ?? "Production status"}
            </h1>
            <p className="text-[12px] text-ink-faint">
              SuperPixel · production status
              {data?.syncedAt && ` · updated ${new Date(data.syncedAt).toLocaleString()}`}
            </p>
          </div>
          <button
            onClick={load}
            className="ml-auto p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-parchment-dark"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {error && <p className="mt-8 text-sm text-ink-soft text-center">{error}</p>}
        {!data && !error && <p className="mt-8 text-sm text-ink-faint text-center">Loading…</p>}
        {data?.broken && (
          <p className="mt-8 text-sm text-ink-soft text-center">
            The tracker is being reorganized — check back soon.
          </p>
        )}

        {data && !data.broken && data.stats && (
          <>
            {/* Progress cards */}
            <div
              className="grid gap-2.5 mt-6 mb-5"
              style={{ gridTemplateColumns: `repeat(${Math.min(4, phases.length + 1)}, minmax(0,1fr))` }}
            >
              {data.stats.phases.map((p) => (
                <div key={p.name} className="rounded-xl border border-line bg-card px-3.5 py-2.5">
                  <p className="text-[11px] text-ink-faint mb-1 truncate">{p.name}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-parchment-dark overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${p.approvedPct}%`, backgroundColor: "#34D399" }}
                      />
                    </div>
                    <span className="text-[12px] font-medium tabular-nums">{p.approvedPct}%</span>
                  </div>
                  <p className="text-[10.5px] text-ink-faint mt-1">
                    {p.counts.approved}/{data.stats!.shotCount} approved
                  </p>
                </div>
              ))}
              <div className="rounded-xl border border-line bg-card px-3.5 py-2.5">
                <p className="text-[11px] text-ink-faint mb-1">Shots</p>
                <p className="text-lg font-medium leading-tight">{data.stats.shotCount}</p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative flex-1 min-w-[11rem]">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search shots…"
                  className="w-full rounded-lg border border-line bg-card pl-8 pr-8 py-1.5 text-[13px] outline-none focus:border-ink-faint placeholder:text-ink-faint"
                />
                {q && (
                  <button
                    onClick={() => setQ("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <select
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] text-ink-soft outline-none"
              >
                <option value="">All batches</option>
                {data.stats.batches.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span className="text-[11.5px] text-ink-faint">
                {shots.length} of {data.shots?.length ?? 0}
              </span>
            </div>

            {/* Matrix */}
            <div className="rounded-xl border border-line bg-card overflow-x-auto">
              <div
                className="grid min-w-[40rem]"
                style={{ gridTemplateColumns: `160px 90px repeat(${phases.length}, minmax(140px,1fr))` }}
              >
                <div className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40">Shot</div>
                <div className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40">Batch</div>
                {phases.map((p) => (
                  <div key={p} className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40 truncate">{p}</div>
                ))}
                {shots.map((s) => (
                  <ShotCells key={s.rowIndex} shot={s} phases={phases} />
                ))}
              </div>
              {shots.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] text-ink-faint">No shots match.</p>
              )}
            </div>

            <p className="mt-6 text-center text-[10.5px] text-ink-faint">
              Live view · SuperPixel Assistant
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ShotCells({ shot, phases }: { shot: Shot; phases: string[] }) {
  return (
    <>
      <div className="px-3 py-2 border-t border-line/60 min-w-0">
        <p className="text-[13px] font-medium truncate">{shot.shotId}</p>
        <p className="text-[10.5px] text-ink-faint truncate">
          {[shot.type, shot.complexity].filter(Boolean).join(" · ") || shot.scene}
        </p>
      </div>
      <div className="px-3 py-2 border-t border-line/60 text-[11.5px] text-ink-soft">
        {shot.batch ?? "—"}
      </div>
      {phases.map((p) => {
        const cell = shot.phases[p];
        return (
          <div key={p} className="px-3 py-2 border-t border-line/60 min-w-0">
            {cell ? (
              <>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] max-w-full truncate align-middle ${CHIP[cell.status]}`}>
                  {cell.statusRaw || "To do"}
                </span>
                {cell.assignee && (
                  <span className="ml-1.5 text-[10.5px] text-ink-faint">{cell.assignee}</span>
                )}
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
