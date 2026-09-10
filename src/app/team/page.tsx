"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Users,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Calendar,
  Armchair,
  FolderKanban,
} from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { CountUp } from "@/components/CountUp";

/**
 * Team availability — UI-refresh revamp modeled on the Figma "Team Frame":
 * stat strip (members / on duty / break / off), status filter, and a table
 * of everyone with department, status chip, since-time and current activity.
 * Extras the Figma doesn't have but the studio runs on: today/week hours per
 * row and a click-to-expand detail (weekly split + open tasks).
 */

const STANDBY_ID = "standby";
const STANDBY_COLOR = "#8b5cf6";

interface MemberTask {
  id: string;
  projectId: string;
  title: string;
  phase?: string;
  status: "todo" | "doing" | "review" | "revision" | "done";
  dueDate?: string;
}

interface MemberPulse {
  userKey: string;
  name: string;
  active: { projectId: string; inAt: string; breakAt?: string } | null;
  todayMs: number;
  weekMs: number;
  lastSeen: string | null;
  weekByProject: { projectId: string; ms: number }[];
  tasks: MemberTask[];
}

interface TeamData {
  members: MemberPulse[];
  projects: Record<string, { name: string; color: string }>;
}

type Status = "duty" | "standby" | "break" | "off";

const fmtH = (ms: number): string => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h === 0 && m === 0) return "—";
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Viewer-local time on purpose — simplest mental model. The column header
 *  shows the browser's OWN zone name (WIB, GMT+8, …) so the label is always
 *  truthful for whoever is looking. */
const fmtSince = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const statusOf = (m: MemberPulse): Status =>
  !m.active ? "off" : m.active.breakAt ? "break" : m.active.projectId === STANDBY_ID ? "standby" : "duty";

const STATUS_TASK_CLS: Record<MemberTask["status"], string> = {
  todo: "bg-parchment-dark text-ink-soft",
  doing: "bg-accent-soft text-accent",
  review: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  revision: "bg-red-500/10 text-red-500",
  done: "bg-green-500/15 text-green-600 dark:text-green-400",
};

function StatusChip({ s }: { s: Status }) {
  if (s === "duty")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-parchment-dark/70 px-2.5 py-1 text-[11.5px] font-medium">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
        </span>
        On duty
      </span>
    );
  if (s === "standby")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-[11.5px] font-medium text-violet-600 dark:text-violet-400">
        <Armchair size={11} />
        Standby
      </span>
    );
  if (s === "break")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
        <span className="inline-flex gap-px">
          <span className="w-[3px] h-2.5 bg-current rounded-sm" />
          <span className="w-[3px] h-2.5 bg-current rounded-sm" />
        </span>
        Break
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] text-ink-faint">
      <span className="inline-flex h-1.5 w-1.5 rounded-full border border-ink-faint" />
      Off
    </span>
  );
}

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Status>("all");

  const load = useCallback(async () => {
    const res = await api.get<TeamData>("/api/team");
    if (res.ok) {
      setData(res.data);
      setError("");
    } else setError(res.error);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15_000);
    const onFocus = () => load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const projectName = (id: string) =>
    id === STANDBY_ID ? "Standby" : (data?.projects[id]?.name ?? "Deleted project");
  const projectColor = (id: string) =>
    id === STANDBY_ID ? STANDBY_COLOR : (data?.projects[id]?.color ?? "#888888");

  const members = data?.members ?? [];
  const counts = {
    total: members.length,
    duty: members.filter((m) => statusOf(m) === "duty" || statusOf(m) === "standby").length,
    break: members.filter((m) => statusOf(m) === "break").length,
    off: members.filter((m) => statusOf(m) === "off").length,
  };

  const rank: Record<Status, number> = { duty: 0, standby: 1, break: 2, off: 3 };
  const rows = members
    .filter((m) => {
      if (filter === "all") return true;
      const s = statusOf(m);
      return filter === "duty" ? s === "duty" || s === "standby" : s === filter;
    })
    .sort((a, b) => rank[statusOf(a)] - rank[statusOf(b)] || b.weekMs - a.weekMs);

  /** "Doing task · project" when we know it; project alone otherwise. */
  const activity = (m: MemberPulse): { text: string; color?: string } => {
    if (!m.active) return { text: "—" };
    if (m.active.projectId === STANDBY_ID)
      return { text: "Standby — available for assignment", color: STANDBY_COLOR };
    const doing = m.tasks.find((t) => t.projectId === m.active!.projectId && t.status === "doing");
    const proj = projectName(m.active.projectId);
    return { text: doing ? `${doing.title} · ${proj}` : proj };
  };

  const sinceLabel = (m: MemberPulse): string => {
    if (m.active) return fmtSince(m.active.inAt);
    if (!m.lastSeen) return "never";
    const d = new Date(m.lastSeen);
    return d.toDateString() === new Date().toDateString() ? fmtSince(m.lastSeen) : timeAgo(m.lastSeen);
  };

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // The browser's own name for its timezone — set after mount so the
  // server-rendered HTML (server zone) never mismatches on hydration.
  const [tzLabel, setTzLabel] = useState("local");
  useEffect(() => {
    try {
      const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName");
      if (part?.value) setTzLabel(part.value);
    } catch {}
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      {/* Title row */}
      <div className="flex items-start gap-3 mb-1">
        <div className="flex-1">
          <h1 className="text-[26px] font-semibold tracking-tight">Team availability</h1>
          <p className="text-[13px] text-ink-soft">
            See who is on duty, on break, or off — across the studio.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] text-ink-soft shrink-0">
          <Calendar size={13} className="text-ink-faint" />
          {today}
        </span>
      </div>

      {error && (
        <p className="my-4 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-sm text-ink-faint py-10 text-center">Loading…</p>}

      {data && (
        <>
          {/* Stat strip */}
          <div className="flex flex-wrap items-end gap-10 mt-7 mb-5">
            <Stat n={counts.total} label="Team members" sub="across the studio" />
            <Stat n={counts.duty} label="On duty" sub="clocked in" accent />
            <Stat n={counts.break} label="Break" sub="paused" />
            <Stat n={counts.off} label="Off" sub="clocked out" faint />
            <span className="flex-1" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-ink-soft outline-none self-center"
            >
              <option value="all">All statuses</option>
              <option value="duty">On duty</option>
              <option value="break">Break</option>
              <option value="off">Off</option>
            </select>
          </div>

          {/* Table */}
          <div className="glass-panel rounded-2xl border border-line overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-wide text-ink-faint border-b border-line">
                  <th className="font-medium px-4 py-2.5">Team member</th>
                  <th className="font-medium px-3 py-2.5">Department</th>
                  <th className="font-medium px-3 py-2.5">Status</th>
                  <th className="font-medium px-3 py-2.5">Since · {tzLabel}</th>
                  <th className="font-medium px-3 py-2.5">Current activity</th>
                  <th className="font-medium px-3 py-2.5 text-right">Today · week</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const s = statusOf(m);
                  const act = activity(m);
                  const open = expanded === m.userKey;
                  return (
                    <Fragment key={m.userKey}>
                      <tr
                        onClick={() => setExpanded(open ? null : m.userKey)}
                        className={`border-b border-line/60 cursor-pointer hover:bg-parchment-dark/30 transition-colors ${
                          s === "off" ? "opacity-70" : ""
                        }`}
                        title="Click for details"
                      >
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span className="w-7 h-7 rounded-lg bg-accent-soft text-accent flex items-center justify-center text-[10px] font-bold shrink-0">
                              {initials(m.name)}
                            </span>
                            <span className="font-medium truncate">{m.name}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-ink-soft">—</td>
                        <td className="px-3 py-2.5">
                          <StatusChip s={s} />
                        </td>
                        <td className="px-3 py-2.5 text-ink-soft tabular-nums">{sinceLabel(m)}</td>
                        <td className="px-3 py-2.5 max-w-[16rem]">
                          <span
                            className="block truncate"
                            style={act.color ? { color: act.color } : undefined}
                          >
                            {act.text}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-ink-soft tabular-nums whitespace-nowrap">
                          {fmtH(m.todayMs)} · {fmtH(m.weekMs)}
                        </td>
                        <td className="pr-3 text-ink-faint">
                          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-b border-line/60 bg-parchment-dark/20">
                          <td colSpan={7} className="px-5 py-3.5">
                            <div className="grid gap-5 sm:grid-cols-2">
                              <div>
                                <h4 className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint mb-1.5">
                                  Hours this week
                                </h4>
                                {m.weekByProject.length === 0 && (
                                  <p className="text-[12px] text-ink-faint">No tracked time this week.</p>
                                )}
                                <div className="space-y-1">
                                  {[...m.weekByProject]
                                    .sort((a, b) => b.ms - a.ms)
                                    .map((w) => (
                                      <div key={w.projectId} className="flex items-center gap-2 text-[12.5px]">
                                        <span
                                          className="w-2 h-2 rounded-full shrink-0"
                                          style={{ backgroundColor: projectColor(w.projectId) }}
                                        />
                                        <span className="flex-1 min-w-0 truncate">
                                          {projectName(w.projectId)}
                                        </span>
                                        <span className="tabular-nums text-ink-soft shrink-0">{fmtH(w.ms)}</span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                              <div>
                                <h4 className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint mb-1.5">
                                  <ListChecks size={11} />
                                  Open tasks · {m.tasks.length}
                                </h4>
                                {m.tasks.length === 0 && (
                                  <p className="text-[12px] text-ink-faint">Nothing assigned right now.</p>
                                )}
                                <div className="space-y-1">
                                  {m.tasks.map((t) => (
                                    <div key={t.id} className="flex items-center gap-2 text-[12.5px]">
                                      <span
                                        className={`rounded-full px-1.5 py-0.5 text-[10px] shrink-0 ${STATUS_TASK_CLS[t.status]}`}
                                      >
                                        {t.status}
                                      </span>
                                      <span className="flex-1 min-w-0 truncate" title={t.title}>
                                        {t.title}
                                      </span>
                                      <span className="text-[11px] text-ink-faint truncate max-w-[9rem] shrink-0">
                                        <FolderKanban size={10} className="inline mr-1 -mt-0.5" />
                                        {projectName(t.projectId)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="px-4 py-8 text-center text-[13px] text-ink-faint">
                {members.length === 0
                  ? "No clock activity yet — once people clock in at the clock app, they appear here."
                  : "Nobody matches this filter."}
              </p>
            )}
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <Users size={11} />
            {counts.total} people · live from the clock, refreshes every 15s · on duty shows
            attendance, not allocated capacity.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({
  n,
  label,
  sub,
  accent,
  faint,
}: {
  n: number;
  label: string;
  sub: string;
  accent?: boolean;
  faint?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        className={`text-[40px] font-semibold leading-none tabular-nums tracking-tight ${
          accent ? "text-accent" : faint ? "text-ink-faint" : ""
        }`}
      >
        <CountUp value={n} pad={2} />
      </span>
      <span className="pb-0.5">
        <span className="block text-[12px] font-medium leading-tight">{label}</span>
        <span className="block text-[10.5px] text-ink-faint leading-tight">{sub}</span>
      </span>
    </div>
  );
}
