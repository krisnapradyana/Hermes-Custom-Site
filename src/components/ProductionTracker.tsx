"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Table2,
  RefreshCw,
  ExternalLink,
  TriangleAlert,
  Search,
  Link2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

/**
 * Production Tracker — read-only mirror of the project's client Google
 * Sheet (docs/PROD-TRACKER-PLAN.md). The sheet stays the source of truth;
 * chips keep the sheet's own words, colors come from canonical buckets.
 */

type Bucket = "todo" | "in_progress" | "waiting_client" | "revise" | "approved" | "unknown";
type Role =
  | "shotId"
  | "scene"
  | "thumb"
  | "type"
  | "complexity"
  | "batch"
  | "remark"
  | "phaseStatus"
  | "phaseAssignee"
  | "phaseLink"
  | "ignore";

interface PhaseCell {
  statusRaw: string;
  status: Bucket;
  assignee?: string;
  link?: string;
}
interface Shot {
  rowIndex: number;
  scene?: string;
  shotId: string;
  type?: string;
  complexity?: string;
  batch?: string;
  remark?: string;
  phases: Record<string, PhaseCell>;
}
interface Payload {
  connected: boolean;
  broken?: boolean;
  missing?: string[];
  sheetUrl?: string;
  tab?: string;
  syncedAt?: string;
  shots?: Shot[];
  phases?: string[];
  stats?: {
    phases: { name: string; counts: Record<Bucket, number>; approvedPct: number }[];
    workload: { assignee: string; perPhase: Record<string, Record<Bucket, number>>; total: number }[];
    unknownStatuses: { value: string; count: number }[];
    shotCount: number;
    batches: string[];
  };
}

const BUCKETS: { id: Bucket; label: string; chip: string; bar: string }[] = [
  { id: "todo", label: "To do", chip: "bg-parchment-dark text-ink-soft", bar: "#8a8a8a" },
  { id: "in_progress", label: "In progress", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400", bar: "#FBBF24" },
  { id: "waiting_client", label: "Waiting client", chip: "bg-purple-500/15 text-purple-600 dark:text-purple-400", bar: "#a78bfa" },
  { id: "revise", label: "Revise", chip: "bg-red-500/15 text-red-500", bar: "#F87171" },
  { id: "approved", label: "Approved", chip: "bg-green-500/15 text-green-600 dark:text-green-400", bar: "#34D399" },
  { id: "unknown", label: "Unknown", chip: "border border-dashed border-ink-faint text-ink-faint", bar: "#5c626d" },
];
const chipCls = (b: Bucket) => BUCKETS.find((x) => x.id === b)?.chip ?? "";

/** Client copy of the server heuristic — prefills the wizard's dictionary. */
function guessBucket(raw: string): Bucket {
  const s = raw.trim().toLowerCase();
  if (!s || s === "-") return "todo";
  if (/approv|final|done|uploaded|complete/.test(s)) return "approved";
  if (/revis|reject|redo|fix/.test(s)) return "revise";
  if (/review|feedback|waiting|pending/.test(s)) return "waiting_client";
  if (/progress|wip|working|doing/.test(s)) return "in_progress";
  if (/to.?do|not assigned|backlog|queue/.test(s)) return "todo";
  return "unknown";
}

function guessRole(header: string): Role {
  const h = header.toLowerCase();
  if (/assignee|artist|pic\b/.test(h)) return "phaseAssignee";
  if (/link|frame\.?io|url/.test(h)) return "phaseLink";
  if (/status/.test(h)) return "phaseStatus";
  if (/^shot/.test(h)) return "shotId";
  if (/^scene/.test(h)) return "scene";
  if (/sketch|thumb|image/.test(h)) return "thumb";
  if (/^type/.test(h)) return "type";
  if (/complexity|difficulty/.test(h)) return "complexity";
  if (/batch/.test(h)) return "batch";
  if (/remark|note|comment/.test(h)) return "remark";
  return "ignore";
}

/** "[Colour Script] Status" → "Colour Script". */
const guessPhase = (header: string) =>
  header.match(/\[([^\]]+)\]/)?.[1]?.trim() ??
  header.replace(/status|assignee|link/gi, "").trim() ??
  "";

export function ProductionTracker({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [wizard, setWizard] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<Payload>(`/api/projects/${encodeURIComponent(projectId)}/tracker`);
    if (res.ok) {
      setData(res.data);
      setError("");
    } else setError(res.error);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);
  useFocusRefresh(load);

  if (wizard) {
    return (
      <TrackerWizard
        projectId={projectId}
        initialUrl={data?.sheetUrl}
        onDone={() => {
          setWizard(false);
          setData(null);
          load();
        }}
        onCancel={() => setWizard(false)}
      />
    );
  }

  if (!data && !error) return <p className="text-sm text-ink-faint py-8">Loading…</p>;
  if (error)
    return (
      <p className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500 mb-6">
        {error}
      </p>
    );

  if (data && !data.connected) {
    return (
      <div className="mb-10 rounded-xl border border-line bg-card p-6 text-center">
        <Table2 size={20} className="mx-auto mb-2 text-accent" />
        <p className="text-sm font-medium mb-1">No production sheet connected</p>
        <p className="text-[13px] text-ink-faint mb-4 max-w-md mx-auto">
          Mirror the client tracker here — the sheet stays the source of truth (clients keep
          editing there), this view visualizes it with live progress and workload.
        </p>
        <button
          onClick={() => setWizard(true)}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
        >
          Connect a Google Sheet
        </button>
      </div>
    );
  }

  if (data?.broken) {
    return (
      <div className="mb-10 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
        <p className="flex items-center gap-2 text-sm font-medium mb-1">
          <TriangleAlert size={15} className="text-amber-500" />
          Mapping needs attention
        </p>
        <p className="text-[13px] text-ink-soft mb-2">
          The sheet&apos;s structure changed — these mapped columns no longer match:
        </p>
        <ul className="text-[12.5px] text-ink-soft list-disc ml-5 mb-3">
          {(data.missing ?? []).slice(0, 8).map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            onClick={() => setWizard(true)}
            className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] text-white hover:bg-accent-hover"
          >
            Re-map the sheet
          </button>
          <a
            href={data.sheetUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] text-ink-soft hover:border-ink-faint"
          >
            Open in Sheets
          </a>
        </div>
      </div>
    );
  }

  return <TrackerView data={data!} projectId={projectId} onRemap={() => setWizard(true)} onRefresh={load} />;
}

// ─────────────────────────────────────────────────────────────────────────────

function TrackerView({
  data,
  projectId,
  onRemap,
  onRefresh,
}: {
  data: Payload;
  projectId: string;
  onRemap: () => void;
  onRefresh: () => void;
}) {
  const phases = data.phases ?? [];
  const shots = data.shots ?? [];
  const stats = data.stats!;

  const [q, setQ] = useState("");
  const [batch, setBatch] = useState("");
  const [assignee, setAssignee] = useState("");
  const [bucket, setBucket] = useState<Bucket | "">("");

  const assignees = useMemo(() => stats.workload.map((w) => w.assignee), [stats]);

  const filtered = shots.filter((s) => {
    if (batch && s.batch !== batch) return false;
    if (assignee && !phases.some((p) => s.phases[p]?.assignee === assignee)) return false;
    if (bucket && !phases.some((p) => s.phases[p]?.status === bucket)) return false;
    const needle = q.trim().toLowerCase();
    if (needle) {
      const hay = `${s.shotId} ${s.scene ?? ""} ${s.remark ?? ""} ${s.type ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const disconnect = async () => {
    await api.del(`/api/projects/${encodeURIComponent(projectId)}/tracker`);
    onRefresh();
  };

  return (
    <div className="mb-10">
      {/* Header strip */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="rounded-full border border-accent/50 bg-accent-soft/40 px-2.5 py-0.5 text-[10.5px] uppercase tracking-wide text-accent">
          synced from Google Sheets
        </span>
        {data.syncedAt && (
          <span className="text-[11.5px] text-ink-faint">synced {timeAgo(data.syncedAt)}</span>
        )}
        <span className="flex-1" />
        <button
          onClick={onRefresh}
          className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-parchment-dark"
          title="Refresh now"
        >
          <RefreshCw size={13} />
        </button>
        <a
          href={data.sheetUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-soft hover:border-ink-faint hover:text-ink"
        >
          <ExternalLink size={12} />
          Open in Sheets
        </a>
        <button onClick={onRemap} className="text-[11.5px] text-ink-faint hover:text-ink px-1">
          Re-map
        </button>
        <button onClick={disconnect} className="text-[11.5px] text-ink-faint hover:text-red-500 px-1">
          Disconnect
        </button>
      </div>

      {/* Unknown-status banner */}
      {stats.unknownStatuses.length > 0 && (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400">
          {stats.unknownStatuses.length} status value
          {stats.unknownStatuses.length > 1 ? "s" : ""} not in the dictionary:{" "}
          {stats.unknownStatuses.slice(0, 5).map((u) => `"${u.value}"`).join(", ")} — use Re-map to
          classify them.
        </p>
      )}

      {/* Progress cards */}
      <div className="grid gap-2.5 mb-4" style={{ gridTemplateColumns: `repeat(${Math.min(4, phases.length + 1)}, minmax(0,1fr))` }}>
        {stats.phases.map((p) => (
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
              {p.counts.revise > 0 && <span className="text-red-500">{p.counts.revise} revise · </span>}
              {p.counts.waiting_client > 0 && `${p.counts.waiting_client} waiting · `}
              {p.counts.approved}/{stats.shotCount} approved
            </p>
          </div>
        ))}
        <div className="rounded-xl border border-line bg-card px-3.5 py-2.5">
          <p className="text-[11px] text-ink-faint mb-1">Shots</p>
          <p className="text-lg font-medium leading-tight">{stats.shotCount}</p>
          <p className="text-[10.5px] text-ink-faint">{stats.batches.length} batch{stats.batches.length === 1 ? "" : "es"}</p>
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
            <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
              <X size={12} />
            </button>
          )}
        </div>
        <select value={batch} onChange={(e) => setBatch(e.target.value)} className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] text-ink-soft outline-none">
          <option value="">All batches</option>
          {stats.batches.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] text-ink-soft outline-none">
          <option value="">All artists</option>
          {assignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select value={bucket} onChange={(e) => setBucket(e.target.value as Bucket | "")} className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] text-ink-soft outline-none">
          <option value="">Any status</option>
          {BUCKETS.filter((b) => b.id !== "unknown").map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
        <span className="text-[11.5px] text-ink-faint">{filtered.length} of {shots.length}</span>
      </div>

      {/* Matrix */}
      <div className="rounded-xl border border-line bg-card overflow-x-auto mb-5">
        <div
          className="grid min-w-[46rem]"
          style={{ gridTemplateColumns: `180px 90px repeat(${phases.length}, minmax(150px,1fr))` }}
        >
          <div className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40">Shot</div>
          <div className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40">Batch</div>
          {phases.map((p) => (
            <div key={p} className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40 truncate">{p}</div>
          ))}
          {filtered.map((s) => (
            <ShotRow key={s.rowIndex} shot={s} phases={phases} />
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px] text-ink-faint">No shots match the filters.</p>
        )}
      </div>

      {/* Workload */}
      {stats.workload.length > 0 && (
        <div className="rounded-xl border border-line bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-2.5">
            Artist workload (from the sheet)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-ink-faint">
                  <th className="pb-1.5 pr-3 font-medium">Artist</th>
                  {phases.map((p) => (
                    <th key={p} className="pb-1.5 pr-3 font-medium">{p}</th>
                  ))}
                  <th className="pb-1.5 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {stats.workload.map((w) => (
                  <tr key={w.assignee} className="border-t border-line/60">
                    <td className="py-1.5 pr-3 font-medium">{w.assignee}</td>
                    {phases.map((p) => {
                      const c = w.perPhase[p];
                      const total = c ? Object.values(c).reduce((a, b) => a + b, 0) : 0;
                      return (
                        <td key={p} className="py-1.5 pr-3">
                          {total === 0 ? (
                            <span className="text-ink-faint">—</span>
                          ) : (
                            <span
                              title={BUCKETS.map((b) => `${b.label}: ${c?.[b.id] ?? 0}`).join(" · ")}
                            >
                              {total}
                              {c && c.approved > 0 && (
                                <span className="text-green-600 dark:text-green-400"> ({c.approved}✓)</span>
                              )}
                              {c && c.revise > 0 && <span className="text-red-500"> ({c.revise}⟳)</span>}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-1.5 font-medium tabular-nums">{w.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ShotRow({ shot, phases }: { shot: Shot; phases: string[] }) {
  return (
    <>
      <div className="px-3 py-2 border-t border-line/60 min-w-0">
        <p className="text-[13px] font-medium truncate">{shot.shotId}</p>
        <p className="text-[10.5px] text-ink-faint truncate">
          {[shot.type, shot.complexity].filter(Boolean).join(" · ") || shot.scene}
        </p>
      </div>
      <div className="px-3 py-2 border-t border-line/60 text-[11.5px] text-ink-soft">{shot.batch ?? "—"}</div>
      {phases.map((p) => {
        const cell = shot.phases[p];
        if (!cell) return <div key={p} className="px-3 py-2 border-t border-line/60" />;
        const label = cell.statusRaw || "To do";
        return (
          <div key={p} className="px-3 py-2 border-t border-line/60 min-w-0" title={shot.remark}>
            <span className={`inline-block rounded-full px-2 py-0.5 text-[10.5px] max-w-full truncate align-middle ${chipCls(cell.status)}`}>
              {label}
            </span>
            {cell.assignee && <span className="ml-1.5 text-[10.5px] text-ink-faint">{cell.assignee}</span>}
            {cell.link && (
              <a href={cell.link} target="_blank" rel="noreferrer" className="ml-1 inline-block align-middle text-accent" title="Open review link">
                <Link2 size={11} />
              </a>
            )}
          </div>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TrackerWizard({
  projectId,
  initialUrl,
  onDone,
  onCancel,
}: {
  projectId: string;
  initialUrl?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [inspect, setInspect] = useState<{ tabs: string[]; tab: string; values: string[][] } | null>(null);
  const [headerRows, setHeaderRows] = useState(2);
  const [roles, setRoles] = useState<{ index: number; header: string; role: Role; phase: string }[]>([]);
  const [dict, setDict] = useState<Record<string, Bucket>>({});

  const doInspect = async (tab?: string) => {
    setBusy(true);
    setErr("");
    const res = await api.get<{ tabs: string[]; tab: string; values: string[][] }>(
      `/api/projects/${encodeURIComponent(projectId)}/tracker/inspect?url=${encodeURIComponent(url)}${tab ? `&tab=${encodeURIComponent(tab)}` : ""}`
    );
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setInspect(res.data);
  };

  // Flattened headers for the chosen headerRows.
  const headers = useMemo(() => {
    if (!inspect) return [];
    const width = Math.max(0, ...inspect.values.slice(0, Math.max(1, headerRows)).map((r) => r.length));
    return Array.from({ length: width }, (_, i) => {
      const parts: string[] = [];
      for (let r = 0; r < headerRows; r++) {
        const v = (inspect.values[r]?.[i] ?? "").toString().trim();
        if (v) parts.push(v);
      }
      return parts.join(" ");
    });
  }, [inspect, headerRows]);

  // Re-propose roles when headers change.
  useEffect(() => {
    setRoles(
      headers.map((h, i) => {
        const role = h ? guessRole(h) : "ignore";
        return { index: i, header: h, role, phase: role.startsWith("phase") ? guessPhase(h) : "" };
      })
    );
  }, [headers]);

  // Distinct status values across mapped status columns.
  const distinct = useMemo(() => {
    if (!inspect) return [];
    const statusCols = roles.filter((r) => r.role === "phaseStatus").map((r) => r.index);
    const map = new Map<string, number>();
    for (const row of inspect.values.slice(headerRows)) {
      for (const c of statusCols) {
        const v = (row[c] ?? "").toString().trim();
        if (v) map.set(v, (map.get(v) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [inspect, roles, headerRows]);

  useEffect(() => {
    setDict((prev) => {
      const next = { ...prev };
      for (const [v] of distinct) {
        const k = v.toLowerCase();
        if (!(k in next)) next[k] = guessBucket(v);
      }
      return next;
    });
  }, [distinct]);

  const save = async () => {
    setBusy(true);
    setErr("");
    const res = await api.post(`/api/projects/${encodeURIComponent(projectId)}/tracker`, {
      sheetUrl: url,
      tab: inspect!.tab,
      headerRows,
      columns: roles
        .filter((r) => r.role !== "ignore")
        .map((r) => ({ index: r.index, header: r.header, role: r.role, phase: r.phase || undefined })),
      statusDict: dict,
    });
    setBusy(false);
    if (!res.ok) {
      setErr((res as { error: string }).error);
      return;
    }
    onDone();
  };

  const roleOptions: [Role, string][] = [
    ["ignore", "Ignore"],
    ["shotId", "Shot ID"],
    ["scene", "Scene"],
    ["thumb", "Thumbnail"],
    ["type", "Type"],
    ["complexity", "Complexity"],
    ["batch", "Batch"],
    ["remark", "Remark"],
    ["phaseStatus", "Phase · status"],
    ["phaseAssignee", "Phase · assignee"],
    ["phaseLink", "Phase · link"],
  ];

  return (
    <div className="mb-10 rounded-xl border border-line bg-card p-5 space-y-4">
      <div>
        <p className="text-sm font-medium">Connect a production sheet</p>
        <p className="text-[12px] text-ink-faint">
          One-time mapping — the sheet stays the source of truth; this view only reads it.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste the Google Sheets link"
          className="flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm font-mono outline-none focus:border-ink-faint"
        />
        <button
          onClick={() => doInspect()}
          disabled={!url.trim() || busy}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {busy && !inspect ? "Reading…" : "Read sheet"}
        </button>
      </div>

      {err && <p className="text-[13px] text-red-500">{err}</p>}

      {inspect && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              Tab
              <select
                value={inspect.tab}
                onChange={(e) => doInspect(e.target.value)}
                className="rounded-lg border border-line bg-card px-2 py-1.5 text-[13px] outline-none"
              >
                {inspect.tabs.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
              Header rows
              <select
                value={headerRows}
                onChange={(e) => setHeaderRows(Number(e.target.value))}
                className="rounded-lg border border-line bg-card px-2 py-1.5 text-[13px] outline-none"
              >
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <span className="text-[11.5px] text-ink-faint">
              {inspect.values.length - headerRows} data rows
            </span>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-1.5">
              1 · What is each column?
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {roles.map((r, i) =>
                !r.header && r.role === "ignore" ? null : (
                  <div key={r.index} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                    <span className="flex-1 min-w-0 truncate text-[12.5px]" title={r.header}>
                      {r.header || `(column ${r.index + 1})`}
                    </span>
                    <select
                      value={r.role}
                      onChange={(e) =>
                        setRoles((all) =>
                          all.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  role: e.target.value as Role,
                                  phase: (e.target.value as Role).startsWith("phase")
                                    ? x.phase || guessPhase(x.header)
                                    : "",
                                }
                              : x
                          )
                        )
                      }
                      className="rounded-md border border-line bg-card px-1.5 py-1 text-[11.5px] text-accent outline-none shrink-0"
                    >
                      {roleOptions.map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    {r.role.startsWith("phase") && (
                      <input
                        value={r.phase}
                        onChange={(e) =>
                          setRoles((all) => all.map((x, j) => (j === i ? { ...x, phase: e.target.value } : x)))
                        }
                        placeholder="Phase name"
                        className="w-28 rounded-md border border-line bg-transparent px-1.5 py-1 text-[11.5px] outline-none shrink-0"
                      />
                    )}
                  </div>
                )
              )}
            </div>
          </div>

          {distinct.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-1.5">
                2 · What does each status word mean?
              </p>
              <div className="flex flex-wrap gap-1.5">
                {distinct.map(([v, count]) => {
                  const k = v.toLowerCase();
                  const b = dict[k] ?? "unknown";
                  return (
                    <label key={v} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] ${chipCls(b)}`}>
                      <span className="max-w-[12rem] truncate" title={`${v} · ${count} cells`}>
                        &ldquo;{v}&rdquo;
                      </span>
                      <select
                        value={b}
                        onChange={(e) => setDict((d) => ({ ...d, [k]: e.target.value as Bucket }))}
                        className="bg-transparent text-[11px] outline-none"
                      >
                        {BUCKETS.map((x) => (
                          <option key={x.id} value={x.id}>{x.label}</option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={busy || !roles.some((r) => r.role === "phaseStatus")}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? "Saving…" : "Connect sheet"}
            </button>
            <button onClick={onCancel} className="rounded-lg px-3.5 py-2 text-sm text-ink-soft hover:bg-parchment-dark">
              Cancel
            </button>
          </div>
        </>
      )}
      {!inspect && (
        <button onClick={onCancel} className="text-[12.5px] text-ink-faint hover:text-ink">
          Cancel
        </button>
      )}
    </div>
  );
}
