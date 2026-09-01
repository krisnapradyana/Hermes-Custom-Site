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
  Share2,
  Copy,
  Plus,
  CalendarRange,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useFocusRefresh } from "@/lib/use-focus-refresh";
import { useTimelineView, TIMELINE_HINT } from "@/lib/use-timeline-view";

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
  thumb?: string;
  type?: string;
  complexity?: string;
  batch?: string;
  remark?: string;
  phases: Record<string, PhaseCell>;
}
interface ScheduleBlock {
  label: string;
  start: string;
  end: string;
  row: number;
}
interface Payload {
  connected: boolean;
  broken?: boolean;
  missing?: string[];
  sheetUrl?: string;
  tab?: string;
  syncedAt?: string;
  shareToken?: string | null;
  schedule?: { tab: string; blocks?: ScheduleBlock[]; error?: string };
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

interface Template {
  name: string;
  headerRows: number;
  columns: { header: string; role: Role; phase?: string }[];
  statusDict: Record<string, Bucket>;
  savedAt: string;
}

const normHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, " ");

/** Same flattening the wizard uses, but for an arbitrary headerRows count. */
function flattenForRows(values: string[][], headerRows: number): string[] {
  const width = Math.max(0, ...values.slice(0, Math.max(1, headerRows)).map((r) => r.length));
  return Array.from({ length: width }, (_, i) => {
    const parts: string[] = [];
    for (let r = 0; r < headerRows; r++) {
      const v = (values[r]?.[i] ?? "").toString().trim();
      if (v) parts.push(v);
    }
    return parts.join(" ");
  });
}

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
  const [sharePanel, setSharePanel] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [taskShot, setTaskShot] = useState<Shot | null>(null);

  const assignees = useMemo(() => stats.workload.map((w) => w.assignee), [stats]);

  const shareUrl =
    data.shareToken && typeof window !== "undefined"
      ? `${window.location.origin}/share/tracker/${data.shareToken}`
      : "";

  const shareAction = async (action: "create" | "revoke") => {
    setShareBusy(true);
    await api.post(`/api/projects/${encodeURIComponent(projectId)}/tracker/share`, { action });
    setShareBusy(false);
    setCopied(false);
    onRefresh();
  };

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the input stays selectable */
    }
  };

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
        <button
          onClick={() => setSharePanel((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] ${
            data.shareToken
              ? "border-accent/50 text-accent"
              : "border-line text-ink-soft hover:border-ink-faint hover:text-ink"
          }`}
          title="Share a read-only link with the client"
        >
          <Share2 size={12} />
          Client link
        </button>
        <button onClick={onRemap} className="text-[11.5px] text-ink-faint hover:text-ink px-1">
          Re-map
        </button>
        <button onClick={disconnect} className="text-[11.5px] text-ink-faint hover:text-red-500 px-1">
          Disconnect
        </button>
      </div>

      {/* Client share link */}
      {sharePanel && (
        <div className="mb-4 rounded-xl border border-line bg-card p-4">
          <p className="text-[13px] font-medium mb-1">Client link</p>
          <p className="text-[12px] text-ink-faint mb-3">
            A read-only page anyone with the link can open — no sign-in, internal names of the
            sheet and tab hidden. Revoking it kills the old link instantly.
          </p>
          {data.shareToken ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-[16rem] rounded-lg border border-line bg-transparent px-3 py-1.5 text-[12px] font-mono outline-none"
              />
              <button
                onClick={copyShare}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] text-white hover:bg-accent-hover"
              >
                <Copy size={12} />
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                onClick={() => shareAction("revoke")}
                disabled={shareBusy}
                className="text-[12px] text-ink-faint hover:text-red-500 px-1 disabled:opacity-40"
              >
                Revoke
              </button>
            </div>
          ) : (
            <button
              onClick={() => shareAction("create")}
              disabled={shareBusy}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {shareBusy ? "Creating…" : "Create client link"}
            </button>
          )}
        </div>
      )}

      {/* Weekly schedule timeline */}
      {data.schedule?.error && (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400">
          Schedule tab &ldquo;{data.schedule.tab}&rdquo;: {data.schedule.error}
        </p>
      )}
      {(data.schedule?.blocks?.length ?? 0) > 0 && (
        <ScheduleTimeline tab={data.schedule!.tab} blocks={data.schedule!.blocks!} />
      )}

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

      {/* Matrix — explicit min width so many phases scroll sideways instead of squishing */}
      <div className="rounded-xl border border-line bg-card overflow-x-auto mb-5">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `180px 90px repeat(${phases.length}, minmax(160px,1fr))`,
            minWidth: `${270 + phases.length * 160}px`,
          }}
        >
          <div className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40">Shot</div>
          <div className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40">Batch</div>
          {phases.map((p) => (
            <div key={p} className="px-3 py-2 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint bg-parchment-dark/40 truncate">{p}</div>
          ))}
          {filtered.map((s) => (
            <ShotRow key={s.rowIndex} shot={s} phases={phases} onAddTask={() => setTaskShot(s)} />
          ))}
        </div>
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-[13px] text-ink-faint">No shots match the filters.</p>
        )}
      </div>

      {/* Task-from-shot modal */}
      {taskShot && (
        <ShotTaskModal
          projectId={projectId}
          shot={taskShot}
          phases={phases}
          onClose={() => setTaskShot(null)}
        />
      )}

      {/* Workload */}
      {stats.workload.length > 0 && (
        <div className="rounded-xl border border-line bg-card p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-2.5">
            Artist workload (from the sheet)
          </p>
          <div className="overflow-x-auto">
            <table
              className="w-full text-[12.5px]"
              style={{ minWidth: `${200 + phases.length * 110}px` }}
            >
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

function ShotRow({
  shot,
  phases,
  onAddTask,
}: {
  shot: Shot;
  phases: string[];
  onAddTask: () => void;
}) {
  return (
    <>
      <div className="group px-3 py-2 border-t border-line/60 min-w-0 flex items-start gap-2">
        {shot.thumb && /^https?:\/\//i.test(shot.thumb) && (
          <a href={shot.thumb} target="_blank" rel="noreferrer" className="shrink-0" title="Open sketch">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.thumb}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-9 w-14 rounded-md object-cover border border-line/60 bg-parchment-dark"
              onError={(e) => {
                (e.currentTarget.parentElement as HTMLElement).style.display = "none";
              }}
            />
          </a>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate">{shot.shotId}</p>
          <p className="text-[10.5px] text-ink-faint truncate">
            {[shot.type, shot.complexity].filter(Boolean).join(" · ") || shot.scene}
          </p>
        </div>
        <button
          onClick={onAddTask}
          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-md text-ink-faint hover:text-accent hover:bg-parchment-dark transition-opacity"
          title="Create an internal task for this shot"
        >
          <Plus size={12} />
        </button>
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

const DAY = 86_400_000;
const toDay = (iso: string) => Math.floor(new Date(`${iso}T00:00:00`).getTime() / DAY);
const BLOCK_COLORS = ["#60A5FA", "#34D399", "#FBBF24", "#F472B6", "#A78BFA", "#2DD4BF", "#FB923C"];
const blockColor = (label: string) => {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return BLOCK_COLORS[h % BLOCK_COLORS.length];
};

/** The sheet's Weekly tab rendered as bars — same zoom/pan as other timelines. */
function ScheduleTimeline({ tab, blocks }: { tab: string; blocks: ScheduleBlock[] }) {
  const rows = useMemo(() => {
    const byRow = new Map<number, ScheduleBlock[]>();
    for (const b of blocks) {
      const list = byRow.get(b.row) ?? [];
      list.push(b);
      byRow.set(b.row, list);
    }
    return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
  }, [blocks]);

  const [fullFrom, fullTo] = useMemo(() => {
    const days = blocks.flatMap((b) => [toDay(b.start), toDay(b.end)]);
    return [Math.min(...days), Math.max(...days)];
  }, [blocks]);

  const view = useTimelineView(fullFrom, fullTo);
  const today = Math.floor((Date.now() + new Date().getTimezoneOffset() * -60_000) / DAY);

  // Month ticks inside the current window.
  const months = useMemo(() => {
    const out: { day: number; label: string }[] = [];
    const d = new Date(view.from * DAY);
    d.setDate(1);
    for (let i = 0; i < 40; i++) {
      const day = Math.floor(d.getTime() / DAY);
      if (day > view.to) break;
      if (day >= view.from - 31) {
        out.push({
          day: Math.max(day, view.from),
          label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
        });
      }
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [view.from, view.to]);

  return (
    <div className="mb-4 rounded-xl border border-line bg-card p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <CalendarRange size={13} className="text-accent" />
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Schedule (from &ldquo;{tab}&rdquo;)
        </p>
        <span className="flex-1" />
        <span className="text-[10.5px] text-ink-faint hidden sm:inline">{TIMELINE_HINT}</span>
        <button onClick={() => view.zoom(1.4)} className="px-1.5 text-ink-faint hover:text-ink text-[13px]" title="Zoom out">−</button>
        <button onClick={() => view.zoom(1 / 1.4)} className="px-1.5 text-ink-faint hover:text-ink text-[13px]" title="Zoom in">+</button>
        <button
          onClick={view.fit}
          disabled={view.isFit}
          className="rounded-md border border-line px-2 py-0.5 text-[10.5px] text-ink-soft hover:border-ink-faint disabled:opacity-40"
        >
          Fit
        </button>
      </div>

      <div ref={view.canvasRef} {...view.canvasProps} className="relative overflow-hidden select-none">
        {/* Month header */}
        <div className="relative h-5 border-b border-line/60">
          {months.map((m) => (
            <span
              key={m.day}
              className="absolute top-0 text-[10px] text-ink-faint whitespace-nowrap"
              style={{ left: `${view.pct(m.day)}%`, paddingLeft: 3 }}
            >
              {m.label}
            </span>
          ))}
        </div>

        <div className="relative">
          {/* Month gridlines */}
          {months.map((m) => (
            <div
              key={m.day}
              className="absolute top-0 bottom-0 w-px bg-line/50"
              style={{ left: `${view.pct(m.day)}%` }}
            />
          ))}
          {/* Today */}
          {today >= view.from && today <= view.to && (
            <div
              className="absolute top-0 bottom-0 w-px bg-red-400/80 z-10"
              style={{ left: `${view.pct(today)}%` }}
              title="Today"
            />
          )}

          {rows.map((list, i) => (
            <div key={i} className="relative h-7">
              {list.map((b, j) => {
                const s = toDay(b.start);
                const e = toDay(b.end);
                if (e < view.from || s > view.to) return null;
                return (
                  <div
                    key={j}
                    className="absolute top-1 h-5 rounded-md px-1.5 text-[10.5px] leading-5 text-white/95 truncate"
                    style={{
                      left: `${view.pct(s)}%`,
                      width: `${view.spanPct(s, e)}%`,
                      backgroundColor: blockColor(b.label),
                      minWidth: 8,
                    }}
                    title={`${b.label} · ${b.start} → ${b.end}`}
                  >
                    {b.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Mini form: turn a sheet shot into an internal task on the project board. */
function ShotTaskModal({
  projectId,
  shot,
  phases,
  onClose,
}: {
  projectId: string;
  shot: Shot;
  phases: string[];
  onClose: () => void;
}) {
  // Prefer a phase that actually needs work on this shot.
  const suggested =
    phases.find((p) => ["revise", "in_progress", "todo"].includes(shot.phases[p]?.status)) ??
    phases[0] ??
    "";
  const [phase, setPhase] = useState(suggested);
  const [title, setTitle] = useState(`${shot.shotId} — ${suggested}`.trim());
  const [titleTouched, setTitleTouched] = useState(false);
  const [assigneeKey, setAssigneeKey] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [team, setTeam] = useState<{ userKey: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await api.get<{ members: { userKey: string; name: string }[] }>("/api/team");
      if (res.ok) {
        setTeam(res.data.members);
        // Preselect the artist the sheet names on this phase, if we know them.
        const sheetName = shot.phases[suggested]?.assignee?.trim().toLowerCase();
        if (sheetName) {
          const hit = res.data.members.find(
            (m) =>
              m.name.toLowerCase() === sheetName ||
              m.name.toLowerCase().startsWith(sheetName) ||
              sheetName.startsWith(m.name.toLowerCase().split(" ")[0])
          );
          if (hit) setAssigneeKey(hit.userKey);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPhase = (p: string) => {
    setPhase(p);
    if (!titleTouched) setTitle(`${shot.shotId} — ${p}`.trim());
    // Re-suggest assignee from the sheet for the newly picked phase.
    const sheetName = shot.phases[p]?.assignee?.trim().toLowerCase();
    if (sheetName && !assigneeKey) {
      const hit = team.find((m) => m.name.toLowerCase().startsWith(sheetName.split(" ")[0]));
      if (hit) setAssigneeKey(hit.userKey);
    }
  };

  const create = async () => {
    setBusy(true);
    setErr("");
    const member = team.find((m) => m.userKey === assigneeKey);
    const res = await api.post(`/api/projects/${encodeURIComponent(projectId)}/tasks`, {
      title: title.trim(),
      phase: phase || undefined,
      note: shot.remark ? `From tracker: ${shot.remark}` : `From tracker shot ${shot.shotId}`,
      assignee: member ? { key: member.userKey, name: member.name } : undefined,
      dueDate: dueDate || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setErr((res as { error: string }).error);
      return;
    }
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-line bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="text-center py-2">
            <p className="text-sm font-medium mb-1">Task created</p>
            <p className="text-[12.5px] text-ink-faint mb-4">&ldquo;{title}&rdquo; is on the task board.</p>
            <div className="flex justify-center gap-2">
              <Link
                href={`/projects/${encodeURIComponent(projectId)}`}
                prefetch={false}
                className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] text-ink-soft hover:border-ink-faint"
                onClick={onClose}
              >
                Open task board
              </Link>
              <button onClick={onClose} className="rounded-lg bg-accent px-3.5 py-1.5 text-[13px] text-white hover:bg-accent-hover">
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium mb-0.5">New task from shot {shot.shotId}</p>
            <p className="text-[12px] text-ink-faint mb-4">
              Internal only — nothing is written back to the sheet.
            </p>
            <div className="space-y-3">
              <label className="block text-[12px] text-ink-soft">
                Phase
                <select
                  value={phase}
                  onChange={(e) => pickPhase(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none"
                >
                  {phases.map((p) => (
                    <option key={p} value={p}>
                      {p}
                      {shot.phases[p]?.statusRaw ? ` · ${shot.phases[p].statusRaw}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[12px] text-ink-soft">
                Title
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleTouched(true);
                  }}
                  className="mt-1 w-full rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-ink-faint"
                />
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block text-[12px] text-ink-soft">
                  Assignee
                  <select
                    value={assigneeKey}
                    onChange={(e) => setAssigneeKey(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none"
                  >
                    <option value="">Unassigned</option>
                    {team.map((m) => (
                      <option key={m.userKey} value={m.userKey}>{m.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-[12px] text-ink-soft">
                  Due date
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[13px] outline-none focus:border-ink-faint"
                  />
                </label>
              </div>
              {shot.phases[phase]?.assignee && (
                <p className="text-[11px] text-ink-faint">
                  Sheet names <span className="text-ink-soft">{shot.phases[phase].assignee}</span> on
                  this phase.
                </p>
              )}
              {err && <p className="text-[12.5px] text-red-500">{err}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={create}
                  disabled={busy || !title.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  {busy ? "Creating…" : "Create task"}
                </button>
                <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm text-ink-soft hover:bg-parchment-dark">
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
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

  // Templates (auto-recognition + save-as)
  const [templates, setTemplates] = useState<Template[]>([]);
  const [recognized, setRecognized] = useState<Template | null>(null);
  const [tplName, setTplName] = useState("");

  // Mapping details stay collapsed when the heuristics/template already
  // produced a usable mapping — the common path is: pick tab, Connect.
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    api.get<{ templates: Template[] }>("/api/tracker-templates").then((res) => {
      if (res.ok) setTemplates(res.data.templates);
    });
  }, []);

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

  // Recognize a saved template against this tab's headers (score ≥ 0.7 wins).
  useEffect(() => {
    if (!inspect || !templates.length) {
      setRecognized(null);
      return;
    }
    let best: { tpl: Template; score: number } | null = null;
    for (const tpl of templates) {
      const heads = new Set(
        flattenForRows(inspect.values, tpl.headerRows).map(normHeader).filter(Boolean)
      );
      const hit = tpl.columns.filter((c) => heads.has(normHeader(c.header))).length;
      const score = tpl.columns.length ? hit / tpl.columns.length : 0;
      if (score >= 0.7 && (!best || score > best.score)) best = { tpl, score };
    }
    setRecognized(best?.tpl ?? null);
    if (best) setHeaderRows(best.tpl.headerRows);
  }, [inspect, templates]);

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

  // Re-propose roles when headers change; a recognized template wins over
  // the heuristics for every column whose header text it knows.
  useEffect(() => {
    const byHeader = new Map(recognized?.columns.map((c) => [normHeader(c.header), c]) ?? []);
    setRoles(
      headers.map((h, i) => {
        const tpl = h ? byHeader.get(normHeader(h)) : undefined;
        if (tpl) return { index: i, header: h, role: tpl.role, phase: tpl.phase ?? "" };
        const role = h ? guessRole(h) : "ignore";
        return { index: i, header: h, role, phase: role.startsWith("phase") ? guessPhase(h) : "" };
      })
    );
  }, [headers, recognized]);

  // A recognized template also seeds the status dictionary.
  useEffect(() => {
    if (recognized) setDict((prev) => ({ ...recognized.statusDict, ...prev }));
  }, [recognized]);

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
      saveAsTemplate: tplName.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setErr((res as { error: string }).error);
      return;
    }
    onDone();
  };

  const hasStatus = roles.some((r) => r.role === "phaseStatus");
  const phaseNames = [
    ...new Set(roles.filter((r) => r.role === "phaseStatus" && r.phase).map((r) => r.phase)),
  ];
  const mappedCount = roles.filter((r) => r.role !== "ignore").length;
  // Auto-open the details when the automatic mapping isn't usable yet.
  const showDetails = advanced || (!!inspect && !hasStatus);

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
              Tab to mirror
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
            <span className="text-[11.5px] text-ink-faint">
              {Math.max(0, inspect.values.length - headerRows)} data rows
            </span>
          </div>

          {recognized && (
            <p className="rounded-lg border border-green-500/40 bg-green-500/5 px-3 py-2 text-[12px] text-green-600 dark:text-green-400">
              Recognized template &ldquo;{recognized.name}&rdquo; — mapping prefilled.
            </p>
          )}

          {/* Auto-mapping summary — the normal path is: pick tab, Connect. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-parchment-dark/30 px-3 py-2.5 text-[12.5px] text-ink-soft">
            {hasStatus ? (
              <span>
                Mapped {mappedCount} columns automatically · phases:{" "}
                <span className="text-ink font-medium">{phaseNames.join(", ")}</span>
                {distinct.length > 0 && <> · {distinct.length} status words</>}
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                Couldn&apos;t detect the columns on this tab — pick the tab with the shot list, or
                map the columns below.
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={() => setAdvanced((v) => !v)}
              className="text-[12px] text-accent hover:underline"
            >
              {showDetails ? "Hide mapping" : "Adjust mapping"}
            </button>
          </div>

          {showDetails && (
          <>
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

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-1.5">
              What is each column?
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
                What does each status word mean?
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

          </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              placeholder="Save as template (optional)"
              className="w-64 rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[12.5px] outline-none focus:border-ink-faint placeholder:text-ink-faint"
            />
            <span className="text-[11px] text-ink-faint">
              Future sheets with these columns get recognized automatically.
            </span>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={busy || !hasStatus}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? "Saving…" : "Connect sheet"}
            </button>
            <button onClick={onCancel} className="rounded-lg px-3.5 py-2 text-sm text-ink-soft hover:bg-parchment-dark">
              Cancel
            </button>
            {!hasStatus && (
              <span className="text-[11.5px] text-ink-faint">
                Needs at least one phase status column.
              </span>
            )}
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
