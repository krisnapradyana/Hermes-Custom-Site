"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  GanttChart,
  ChevronDown,
  ChevronRight,
  ListChecks,
  ZoomIn,
  ZoomOut,
  Maximize,
  Users,
  FolderKanban,
} from "lucide-react";
import { useFocusRefresh } from "@/lib/use-focus-refresh";
import {
  useTimelineView,
  TIMELINE_HINT,
  OVERDUE_STRIPES,
  DONE_STRIPES,
} from "@/lib/use-timeline-view";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { ProjectRollup, Health, RollupTask } from "@/lib/schedule-rollup";
import type { SchedulePayload, ScheduleTeamMember } from "@/app/api/schedule/route";

/**
 * Schedule — the studio-wide Gantt, producer edition.
 *
 * Above the chart a PULSE STRIP answers "what's on fire?" (overdue, at risk,
 * due soon, unowned work, who's clocked in) and doubles as a filter. Each
 * project row carries a HEALTH chip, a PROGRESS fill inside its bar (tasks
 * done ÷ total), milestone diamonds (hit / open / missed), a red SLIP tail
 * when overdue, and a right-hand column with the people on it (green dot =
 * clocked in now) and the single NEXT thing with a countdown. The chevron
 * still expands dated tasks inline. A PEOPLE lens pivots the same data into
 * open-tasks-per-week per team member.
 *
 * All numbers come from /api/schedule (one call). Interaction model is
 * unchanged: wheel zooms at the cursor, drag pans, Fit resets.
 */

const NAME_W = 250; // px — name + health column
const SIDE_W = 200; // px — people + next-up column

const PHASE_COLORS: Record<string, string> = {
  Styleframes: "#c4a35a",
  Storyboard: "#7d8bc4",
  Animatic: "#6a9b7e",
  Animation: "#2a73e1",
  Render: "#a3719b",
  Revisions: "#d06565",
  "On-site": "#4fae9b",
  Other: "#8a8a8a",
};

const DAY = 86_400_000;
const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const HEALTH: Record<Health, { label: (r: ProjectRollup) => string; cls: string; dot: string }> = {
  ok: {
    label: () => "on track",
    cls: "bg-green-500/15 text-green-600 dark:text-green-400",
    dot: "●",
  },
  risk: {
    label: () => "at risk",
    cls: "bg-amber-500/18 text-amber-600 dark:text-amber-400",
    dot: "●",
  },
  late: {
    label: (r) => `${r.daysLate}d late`,
    cls: "bg-red-500/15 text-red-500",
    dot: "●",
  },
  done: {
    label: () => "done",
    cls: "bg-green-500/15 text-green-600 dark:text-green-400",
    dot: "✓",
  },
  plan: { label: () => "no tasks", cls: "bg-parchment-dark text-ink-faint", dot: "○" },
};

type Filter = "all" | "late" | "risk" | "soon" | "unowned";
type Lens = "projects" | "people";
type Sort = "urgency" | "start";

interface Profile {
  role?: string;
  avatar?: string;
}

const SOON_DAYS = 14;

/** Stable color from a name for avatar fallbacks. */
function hue(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 48%)`;
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function Avatar({
  person,
  profile,
  live,
  size = 22,
}: {
  person: { key: string; name: string };
  profile?: Profile;
  live?: boolean;
  size?: number;
}) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full border-2 border-card font-bold text-white overflow-visible"
      style={{ width: size, height: size, backgroundColor: hue(person.name), fontSize: size * 0.4 }}
      title={`${person.name}${live ? " · clocked in now" : ""}`}
    >
      {profile?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.avatar}
          alt=""
          className="h-full w-full rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        initials(person.name)
      )}
      {live && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-card" />
      )}
    </span>
  );
}

function HealthChip({ r }: { r: ProjectRollup }) {
  const h = HEALTH[r.health];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[1px] text-[10.5px] font-semibold whitespace-nowrap ${h.cls}`}
      title={
        r.health === "risk"
          ? `${Math.round((r.progress ?? 0) * 100)}% of tasks done vs ${Math.round(r.timeElapsed * 100)}% of time elapsed`
          : undefined
      }
    >
      <span className="text-[8px]">{h.dot}</span>
      {h.label(r)}
    </span>
  );
}

export default function SchedulePage() {
  const { data: session } = useSession();
  const myKey = session?.user?.slackId;

  const [data, setData] = useState<SchedulePayload | null>(null);
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const [filter, setFilter] = useState<Filter>("all");
  const [lens, setLens] = useState<Lens>("projects");
  const [sort, setSort] = useState<Sort>("urgency");
  const [hideDone, setHideDone] = useState(false);
  const [mine, setMine] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get<SchedulePayload>("/api/schedule");
    if (res.ok) {
      setData(res.data);
      setError("");
    } else setError(res.error);
  }, []);
  useEffect(() => {
    load();
    // Roles + Slack avatars: once per visit is plenty.
    fetch("/api/team/profiles")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.profiles) setProfiles(d.profiles as Record<string, Profile>);
      })
      .catch(() => {});
  }, [load]);
  useFocusRefresh(load);

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const all = useMemo(() => data?.projects ?? [], [data]);
  const team = data?.team ?? null;
  const liveByProject = useMemo(() => {
    const m = new Map<string, ScheduleTeamMember[]>();
    for (const t of team ?? []) {
      if (!t.activeProjectId) continue;
      m.set(t.activeProjectId, [...(m.get(t.activeProjectId) ?? []), t]);
    }
    return m;
  }, [team]);

  // ---- pulse counts (over everything, independent of the active filter) ----
  const pulse = useMemo(() => {
    const late = all.filter((r) => r.health === "late");
    const risk = all.filter((r) => r.health === "risk");
    const soon = all.filter(
      (r) =>
        r.health !== "done" && r.nextUp && r.nextUp.daysAway >= 0 && r.nextUp.daysAway <= SOON_DAYS
    );
    const unowned = all.reduce((n, r) => n + (r.health === "done" ? 0 : r.tasks.unowned), 0);
    const unownedProjects = all.filter((r) => r.health !== "done" && r.tasks.unowned > 0);
    const working = (team ?? []).filter((t) => t.activeProjectId);
    return { late, risk, soon, unowned, unownedProjects, working };
  }, [all, team]);

  // ---- visible rows ----
  const rows = useMemo(() => {
    let list = all;
    if (filter === "late") list = pulse.late;
    else if (filter === "risk") list = pulse.risk;
    else if (filter === "soon") list = pulse.soon;
    else if (filter === "unowned") list = pulse.unownedProjects;
    if (hideDone) list = list.filter((r) => r.health !== "done");
    if (mine && myKey) list = list.filter((r) => r.people.some((p) => p.key === myKey));
    if (sort === "start") {
      list = [...list].sort((a, b) =>
        (a.startDate ?? a.deadline ?? "").localeCompare(b.startDate ?? b.deadline ?? "")
      );
    }
    return list; // "urgency" is the server's order
  }, [all, filter, pulse, hideDone, mine, myKey, sort]);

  // ---- time window: everything scheduled, so filters never re-zoom the chart ----
  const model = useMemo(() => {
    if (all.length === 0) return null;
    const todayDay = dayOf(today);
    const days: number[] = [todayDay];
    for (const p of all) {
      if (p.startDate) days.push(dayOf(p.startDate));
      if (p.deadline) days.push(dayOf(p.deadline));
      for (const m of p.milestones) days.push(dayOf(m.dueDate));
      for (const t of p.taskRows) if (t.dueDate) days.push(dayOf(t.dueDate));
    }
    return { fullFrom: Math.min(...days) - 3, fullTo: Math.max(...days) + 4, todayDay };
  }, [all, today]);

  const view = useTimelineView(model?.fullFrom ?? 0, model?.fullTo ?? 30, NAME_W, SIDE_W);

  const mondays: { day: number; week: number; label: string }[] = [];
  for (let d = view.from; d <= view.to; d++) {
    if ((d + 3) % 7 === 0) {
      mondays.push({
        day: d,
        week: Math.floor((d + 3) / 7),
        label: new Date(d * DAY).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      });
    }
  }
  const labelEvery = Math.max(1, Math.ceil(mondays.length / 10));

  const tile = (
    key: Filter,
    label: string,
    value: string | number,
    detail: string,
    tone: "" | "red" | "amber" | "green" = ""
  ) => {
    const on = filter === key;
    const toneCls =
      tone === "red"
        ? "text-red-500"
        : tone === "amber"
          ? "text-amber-500"
          : tone === "green"
            ? "text-green-500"
            : "";
    return (
      <button
        key={key}
        onClick={() => setFilter(on ? "all" : key)}
        className={`flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
          on
            ? "border-accent bg-accent-soft/60 ring-2 ring-accent/20"
            : "border-line bg-card hover:border-ink-faint"
        }`}
        title={on ? "Clear filter" : `Show only: ${label.toLowerCase()}`}
      >
        <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
          {label}
        </span>
        <span className={`text-[22px] font-semibold leading-tight ${toneCls}`}>{value}</span>
        <span className="text-[11.5px] text-ink-soft truncate max-w-[12rem]">{detail}</span>
      </button>
    );
  };

  const names = (rs: ProjectRollup[]) =>
    rs.length
      ? rs
          .slice(0, 2)
          .map((r) => r.name)
          .join(" · ") + (rs.length > 2 ? " …" : "")
      : "—";

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
          <GanttChart size={17} className="text-accent" />
        </div>
        <h1 className="font-serif-display text-3xl">Schedule</h1>
      </div>
      <p className="text-sm text-ink-soft mb-6">
        Every active project on one timeline — health, progress, who&apos;s on it and what&apos;s
        next. Click a name to open the project, the chevron to see its tasks.
      </p>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-sm text-ink-faint">Loading…</p>}

      {data && !model && (
        <p className="text-sm text-ink-faint text-center py-10">
          No scheduled projects yet — projects appear here once they have a start date and deadline.
        </p>
      )}

      {data && model && (
        <>
          {/* ---- Pulse strip ---- */}
          <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
            {tile(
              "late",
              "Overdue",
              pulse.late.length,
              names(pulse.late),
              pulse.late.length ? "red" : ""
            )}
            {tile(
              "risk",
              "At risk",
              pulse.risk.length,
              pulse.risk.length ? "behind pace vs. deadline" : "everything on pace",
              pulse.risk.length ? "amber" : ""
            )}
            {tile(
              "soon",
              `Due in ${SOON_DAYS} days`,
              pulse.soon.length,
              (() => {
                const ms = pulse.soon.filter((r) => r.nextUp?.kind === "milestone").length;
                const dl = pulse.soon.length - ms;
                return pulse.soon.length
                  ? `${ms} milestone${ms === 1 ? "" : "s"} · ${dl} deadline${dl === 1 ? "" : "s"}`
                  : "nothing imminent";
              })()
            )}
            {tile(
              "unowned",
              "Unowned tasks",
              pulse.unowned,
              pulse.unowned
                ? `across ${pulse.unownedProjects.length} project${pulse.unownedProjects.length === 1 ? "" : "s"}`
                : "every open task has an owner",
              pulse.unowned ? "amber" : ""
            )}
            <div
              className="flex flex-col items-start gap-0.5 rounded-xl border border-line bg-card px-3.5 py-2.5"
              title={team ? "From the timeclock" : "Timeclock integration not connected"}
            >
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
                Working now
              </span>
              <span
                className={`text-[22px] font-semibold leading-tight ${team && pulse.working.length ? "text-green-500" : ""}`}
              >
                {team ? `${pulse.working.length} / ${team.length}` : "—"}
              </span>
              <span className="text-[11.5px] text-ink-soft truncate max-w-[12rem]">
                {team
                  ? pulse.working.length
                    ? `on ${new Set(pulse.working.map((w) => w.activeProjectId)).size} project${new Set(pulse.working.map((w) => w.activeProjectId)).size === 1 ? "" : "s"}`
                    : "nobody clocked in"
                  : "timeclock not connected"}
              </span>
            </div>
          </div>

          {/* ---- Toolbar ---- */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-full border border-line bg-card">
              <button
                onClick={() => setLens("projects")}
                className={`flex items-center gap-1.5 px-3 py-1 text-[12px] ${lens === "projects" ? "bg-accent-soft text-accent font-semibold" : "text-ink-soft hover:text-ink"}`}
              >
                <FolderKanban size={12} /> Projects
              </button>
              <button
                onClick={() => setLens("people")}
                className={`flex items-center gap-1.5 px-3 py-1 text-[12px] ${lens === "people" ? "bg-accent-soft text-accent font-semibold" : "text-ink-soft hover:text-ink"}`}
              >
                <Users size={12} /> People
              </button>
            </div>
            {lens === "projects" && (
              <>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="rounded-full border border-line bg-card px-2.5 py-1 text-[12px] text-ink-soft outline-none"
                >
                  <option value="urgency">Sort: urgency</option>
                  <option value="start">Sort: start date</option>
                </select>
                <button
                  onClick={() => setHideDone((v) => !v)}
                  className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${hideDone ? "border-accent bg-accent-soft text-accent font-medium" : "border-line text-ink-soft hover:border-ink-faint"}`}
                >
                  Hide done
                </button>
              </>
            )}
            {myKey && (
              <button
                onClick={() => setMine((v) => !v)}
                className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${mine ? "border-accent bg-accent-soft text-accent font-medium" : "border-line text-ink-soft hover:border-ink-faint"}`}
                title="Only projects with tasks assigned to me"
              >
                Mine
              </button>
            )}
            {filter !== "all" && (
              <button
                onClick={() => setFilter("all")}
                className="text-[12px] text-ink-faint hover:text-ink"
              >
                Clear filter
              </button>
            )}
            <span className="flex-1" />
            <span className="text-[11px] text-ink-faint">
              {rows.length} of {all.length} projects
            </span>
          </div>

          {lens === "projects" ? (
            <div className="glass-panel rounded-xl border border-line p-4 overflow-x-auto">
              <div className="min-w-[56rem] relative">
                <div className="flex items-center justify-end gap-1 mb-1">
                  <span className="text-[10px] text-ink-faint mr-1.5">{TIMELINE_HINT}</span>
                  <button
                    onClick={() => view.zoom(1.4)}
                    className="p-2.5 xl:p-1 rounded-md text-ink-faint hover:text-ink hover:bg-parchment-dark"
                    title="Zoom out"
                  >
                    <ZoomOut size={13} />
                  </button>
                  <button
                    onClick={() => view.zoom(1 / 1.4)}
                    className="p-2.5 xl:p-1 rounded-md text-ink-faint hover:text-ink hover:bg-parchment-dark"
                    title="Zoom in"
                  >
                    <ZoomIn size={13} />
                  </button>
                  <button
                    onClick={view.fit}
                    disabled={view.isFit}
                    className="p-2.5 xl:p-1 rounded-md text-ink-faint hover:text-ink hover:bg-parchment-dark disabled:opacity-30"
                    title="Fit everything"
                  >
                    <Maximize size={13} />
                  </button>
                </div>

                <div ref={view.canvasRef} {...view.canvasProps}>
                  {/* column headers + week labels */}
                  <div className="flex h-5 mb-1 text-[10px] text-ink-faint">
                    <div style={{ width: NAME_W }} className="shrink-0 uppercase tracking-wide">
                      Project · health
                    </div>
                    <div className="relative flex-1 overflow-hidden">
                      {mondays.map(
                        (w) =>
                          w.week % labelEvery === 0 && (
                            <span
                              key={w.day}
                              className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                              style={{ left: `${view.pct(w.day)}%` }}
                            >
                              {w.label}
                            </span>
                          )
                      )}
                    </div>
                    <div
                      style={{ width: SIDE_W }}
                      className="shrink-0 text-right uppercase tracking-wide"
                    >
                      Team · next up
                    </div>
                  </div>

                  <div className="relative">
                    {/* gridlines + TODAY across all rows */}
                    <div
                      className="absolute inset-y-0 overflow-hidden"
                      style={{ left: NAME_W, right: SIDE_W }}
                    >
                      {mondays.map((w) => (
                        <span
                          key={w.day}
                          className="absolute inset-y-0 w-px bg-line/50"
                          style={{ left: `${view.pct(w.day)}%` }}
                        />
                      ))}
                      {model.todayDay >= view.from && model.todayDay <= view.to && (
                        <div
                          className="absolute inset-y-0 w-0.5 bg-accent z-10"
                          style={{ left: `${view.pct(model.todayDay)}%` }}
                          title="Today"
                        >
                          <span className="absolute -top-0.5 left-1 text-[9px] font-medium text-accent">
                            TODAY
                          </span>
                        </div>
                      )}
                    </div>

                    {rows.length === 0 && (
                      <p className="py-8 text-center text-[13px] text-ink-faint">
                        Nothing matches — clear the filter above.
                      </p>
                    )}

                    {rows.map((p) => {
                      const a = p.startDate ? dayOf(p.startDate) : dayOf(p.deadline!);
                      const b = p.deadline ? dayOf(p.deadline) : a;
                      const isDone = p.health === "done";
                      const isLate = p.health === "late";
                      const isOpen = expanded === p.id;
                      const live = liveByProject.get(p.id) ?? [];
                      const pct = p.progress == null ? null : Math.round(p.progress * 100);
                      const barLeft = view.pct(Math.min(a, b));
                      const barW = view.spanPct(Math.min(a, b), b);
                      const shown = p.people.slice(0, 3);
                      const extra = p.people.length - shown.length;
                      return (
                        <div
                          key={p.id}
                          className={`relative ${isDone ? "opacity-60" : ""}`}
                          onMouseEnter={() => setHover(p.id)}
                          onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}
                        >
                          <div className="flex items-center h-11 rounded-lg hover:bg-ink/[0.03] dark:hover:bg-white/[0.03]">
                            {/* name + health */}
                            <div
                              style={{ width: NAME_W }}
                              className="shrink-0 flex items-center gap-1.5 pr-2 min-w-0"
                            >
                              <button
                                onClick={() => setExpanded(isOpen ? null : p.id)}
                                className="p-0.5 text-ink-faint hover:text-ink shrink-0"
                                title={isOpen ? "Hide tasks" : "Show tasks"}
                              >
                                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                              </button>
                              <Link
                                prefetch={false}
                                href={`/projects/${encodeURIComponent(p.id)}`}
                                className="text-[12.5px] font-medium truncate uppercase hover:text-accent transition-colors"
                                title={`Open ${p.name}`}
                              >
                                {p.name}
                              </Link>
                              <HealthChip r={p} />
                            </div>

                            {/* lane */}
                            <div className="flex-1 relative h-6 overflow-hidden">
                              {/* slip tail: deadline → today, hatched red */}
                              {isLate && model.todayDay > b && (
                                <div
                                  className="absolute top-[7px] h-[10px] rounded-r"
                                  style={{
                                    left: `${view.pct(b + 1)}%`,
                                    width: `${view.spanPct(b + 1, model.todayDay)}%`,
                                    backgroundImage:
                                      "repeating-linear-gradient(135deg, #ef4444 0 4px, rgba(239,68,68,0.35) 4px 8px)",
                                  }}
                                  title={`${p.daysLate} days past the deadline`}
                                >
                                  <span className="absolute -right-8 -top-[3px] text-[10px] font-semibold text-red-500">
                                    +{p.daysLate}d
                                  </span>
                                </div>
                              )}
                              {/* bar */}
                              <div
                                className={`absolute inset-y-0 rounded-md overflow-hidden flex items-center ${
                                  isLate
                                    ? "ring-1 ring-red-500"
                                    : isDone
                                      ? "ring-1 ring-green-500"
                                      : ""
                                }`}
                                style={{
                                  left: `${barLeft}%`,
                                  width: `${barW}%`,
                                  backgroundColor: `${p.color}cc`,
                                  backgroundImage: isDone
                                    ? DONE_STRIPES
                                    : isLate
                                      ? OVERDUE_STRIPES
                                      : undefined,
                                }}
                                title={`${p.name} · ${p.startDate ?? "?"} → ${p.deadline ?? "?"}`}
                              >
                                {pct != null && !isDone && (
                                  <div
                                    className="absolute inset-y-0 left-0 bg-white/25 dark:bg-white/20"
                                    style={{ width: `${pct}%` }}
                                  />
                                )}
                                <span className="relative pl-2 text-[10.5px] font-bold text-white drop-shadow whitespace-nowrap">
                                  {isDone ? "100%" : pct != null ? `${pct}%` : ""}
                                </span>
                                <span className="relative ml-auto pr-2 text-[10px] text-white/85 whitespace-nowrap">
                                  {isDone
                                    ? `delivered ${p.doneAt ? fmtDay(p.doneAt.slice(0, 10)) : ""}`
                                    : pct != null
                                      ? `${p.tasks.done}/${p.tasks.total}${p.tasks.review ? ` · ${p.tasks.review} in review` : ""}`
                                      : "plan only — add tasks to track"}
                                </span>
                              </div>
                              {/* milestones */}
                              {p.milestones.map((m) => (
                                <span
                                  key={m.id}
                                  className={`absolute top-1/2 z-10 h-[9px] w-[9px] rounded-[1px] border-[1.5px] border-white ${
                                    m.state === "hit"
                                      ? "bg-green-500"
                                      : m.state === "missed"
                                        ? "bg-red-500"
                                        : "bg-card"
                                  }`}
                                  style={{
                                    left: `${view.pct(dayOf(m.dueDate))}%`,
                                    transform: "translate(-50%,-50%) rotate(45deg)",
                                  }}
                                  title={`${m.title} — ${fmtDay(m.dueDate)}${m.state === "missed" ? " · missed" : m.state === "hit" ? " · hit" : ""}`}
                                />
                              ))}
                            </div>

                            {/* people + next up */}
                            <div
                              style={{ width: SIDE_W }}
                              className="shrink-0 flex items-center justify-between gap-2 pl-3"
                            >
                              <div className="flex items-center -space-x-1.5">
                                {shown.map((per) => (
                                  <Avatar
                                    key={per.key}
                                    person={per}
                                    profile={profiles[per.key]}
                                    live={live.some((l) => l.key === per.key)}
                                  />
                                ))}
                                {/* clocked in but with no open task here — still on it */}
                                {live
                                  .filter((l) => !p.people.some((per) => per.key === l.key))
                                  .slice(0, 1)
                                  .map((l) => (
                                    <Avatar key={l.key} person={l} profile={profiles[l.key]} live />
                                  ))}
                                {extra > 0 && (
                                  <span
                                    className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-card bg-parchment-dark text-[9px] text-ink-soft"
                                    title={p.people
                                      .slice(3)
                                      .map((x) => x.name)
                                      .join(", ")}
                                  >
                                    +{extra}
                                  </span>
                                )}
                                {p.people.length === 0 && live.length === 0 && (
                                  <span className="text-[11px] text-ink-faint">—</span>
                                )}
                              </div>
                              <div className="text-right leading-tight whitespace-nowrap">
                                {p.nextUp ? (
                                  <>
                                    <div
                                      className={`text-[11.5px] font-semibold truncate max-w-[7.5rem] ${
                                        p.nextUp.daysAway < 0
                                          ? "text-red-500"
                                          : p.nextUp.daysAway <= 3
                                            ? "text-amber-500"
                                            : ""
                                      }`}
                                      title={p.nextUp.title}
                                    >
                                      {p.nextUp.title}
                                    </div>
                                    <div className="text-[11px] text-ink-soft">
                                      {p.nextUp.daysAway < 0
                                        ? `was due ${fmtDay(p.nextUp.date)}`
                                        : p.nextUp.daysAway === 0
                                          ? "today"
                                          : `in ${p.nextUp.daysAway}d · ${fmtDay(p.nextUp.date)}`}
                                    </div>
                                  </>
                                ) : (
                                  <div className="text-[11px] text-ink-faint">
                                    {isDone ? "—" : "no next step"}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* hover card */}
                          {hover === p.id && !isOpen && (
                            <div
                              className="pointer-events-none absolute z-30 w-72 rounded-xl border border-line bg-card px-3.5 py-3 text-[12px] shadow-2xl"
                              style={{ left: NAME_W + 8, top: "100%" }}
                            >
                              <div className="mb-1.5 flex items-center justify-between gap-2">
                                <span className="font-semibold truncate">{p.name}</span>
                                <HealthChip r={p} />
                              </div>
                              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-ink-soft">
                                <dt>Timeline</dt>
                                <dd className="text-ink">
                                  {p.startDate ? fmtDay(p.startDate) : "?"} →{" "}
                                  {p.deadline ? fmtDay(p.deadline) : "?"} ·{" "}
                                  {Math.round(p.timeElapsed * 100)}% elapsed
                                </dd>
                                <dt>Tasks</dt>
                                <dd className="text-ink">
                                  {p.tasks.total
                                    ? `${p.tasks.done}/${p.tasks.total} done${p.tasks.review ? ` · ${p.tasks.review} in review` : ""}${p.tasks.revision ? ` · ${p.tasks.revision} in revision` : ""}${p.tasks.unowned ? ` · ${p.tasks.unowned} unowned` : ""}`
                                    : "none yet"}
                                </dd>
                                <dt>Milestones</dt>
                                <dd className="text-ink">
                                  {p.milestones.length
                                    ? `${p.milestones.filter((m) => m.state === "hit").length} hit · ${p.milestones.filter((m) => m.state === "open").length} open${p.milestones.some((m) => m.state === "missed") ? ` · ${p.milestones.filter((m) => m.state === "missed").length} missed` : ""}`
                                    : "none"}
                                </dd>
                                <dt>People</dt>
                                <dd className="text-ink">
                                  {p.people.length
                                    ? p.people
                                        .map((x) => `${x.name.split(" ")[0]} (${x.open})`)
                                        .join(", ")
                                    : "nobody assigned"}
                                </dd>
                                {live.length > 0 && (
                                  <>
                                    <dt>Clocked in</dt>
                                    <dd className="text-green-600 dark:text-green-400">
                                      {live.map((l) => l.name.split(" ")[0]).join(", ")}
                                    </dd>
                                  </>
                                )}
                                <dt>Last activity</dt>
                                <dd className="text-ink">
                                  {p.lastActivityAt ? timeAgo(p.lastActivityAt) : "—"}
                                </dd>
                              </dl>
                            </div>
                          )}

                          {isOpen && (
                            <div className="pb-2">
                              {p.taskRows.length === 0 && (
                                <p
                                  style={{ marginLeft: NAME_W }}
                                  className="text-[11px] text-ink-faint py-1"
                                >
                                  No dated tasks — set start/due dates on tasks to see them here.
                                </p>
                              )}
                              {p.taskRows.map((t) => (
                                <TaskRow key={t.id} t={t} today={today} view={view} />
                              ))}
                              <div style={{ marginLeft: NAME_W }} className="pt-1">
                                <Link
                                  prefetch={false}
                                  href={`/projects/${encodeURIComponent(p.id)}/tasks`}
                                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
                                >
                                  <ListChecks size={11} />
                                  Open Task Board
                                </Link>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[10px] text-ink-faint">
                  <span>
                    <span className="text-green-500">●</span> on track
                  </span>
                  <span>
                    <span className="text-amber-500">●</span> at risk — % done trails % time elapsed
                    by 15+ pts
                  </span>
                  <span>
                    <span className="text-red-500">●</span> overdue · hatched tail = slip
                  </span>
                  <span>◆ milestone: filled green = hit · hollow = open · red = missed</span>
                  <span>lighter band inside a bar = tasks done</span>
                  {team && (
                    <span>
                      <span className="text-green-500">●</span> on avatar = clocked in now
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <PeopleLens
              rows={all}
              team={team}
              profiles={profiles}
              today={today}
              mine={mine ? myKey : undefined}
            />
          )}

          {data.unscheduled.length > 0 && (
            <p className="mt-4 text-[12px] text-ink-faint">
              Not on the chart (no dates set):{" "}
              {data.unscheduled.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && " · "}
                  <Link
                    prefetch={false}
                    href={`/projects/${encodeURIComponent(p.id)}`}
                    className="uppercase hover:text-ink underline decoration-line"
                  >
                    {p.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** One expanded task under a project: bar by phase, owner + status, flags on the right. */
function TaskRow({
  t,
  today,
  view,
}: {
  t: RollupTask;
  today: string;
  view: ReturnType<typeof useTimelineView>;
}) {
  const ta = dayOf(t.startDate ?? t.createdAt);
  const tb = dayOf(t.dueDate!);
  const over = t.status !== "done" && t.dueDate! < today;
  const waiting = t.waitingDays >= 2 && t.status !== "done";
  return (
    <div className="flex items-center h-6">
      <div style={{ width: NAME_W }} className="shrink-0 pl-9 pr-2 min-w-0">
        <span className="block text-[11px] text-ink-soft truncate" title={t.title}>
          {t.title}
        </span>
      </div>
      <div className="flex-1 relative h-4 overflow-hidden">
        <div
          className={`absolute inset-y-0 rounded flex items-center px-1.5 overflow-hidden ${t.status === "done" ? "opacity-40" : ""} ${over ? "ring-1 ring-red-500" : ""}`}
          style={{
            left: `${view.pct(Math.min(ta, tb))}%`,
            width: `${view.spanPct(Math.min(ta, tb), tb)}%`,
            backgroundColor: `${PHASE_COLORS[t.phase ?? "Other"] ?? "#8a8a8a"}bb`,
            backgroundImage: over ? OVERDUE_STRIPES : undefined,
          }}
          title={`${t.title}${t.assignee ? ` — ${t.assignee.name}` : " — unassigned"} · ${t.status} · due ${t.dueDate}`}
        >
          <span className="text-[9.5px] text-white truncate">
            {t.assignee ? t.assignee.name.split(" ")[0] : "unassigned"} · {t.status}
          </span>
        </div>
      </div>
      <div
        style={{ width: SIDE_W }}
        className="shrink-0 flex items-center justify-between gap-2 pl-3 text-[10.5px] text-ink-faint whitespace-nowrap"
      >
        <span className={over ? "text-red-500" : ""}>
          {over ? "was due " : "due "}
          {fmtDay(t.dueDate!)}
        </span>
        <span className="flex items-center gap-2">
          {!t.assignee && t.status !== "done" && (
            <span className="text-red-500 font-medium">no owner</span>
          )}
          {waiting && (
            <span className="text-amber-500 font-medium">
              waiting {t.waitingDays}d in {t.status}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** People lens: open tasks due per week per person, plus what they're clocked into now. */
function PeopleLens({
  rows,
  team,
  profiles,
  today,
  mine,
}: {
  rows: ProjectRollup[];
  team: ScheduleTeamMember[] | null;
  profiles: Record<string, Profile>;
  today: string;
  mine?: string;
}) {
  const WEEKS = 8;
  const todayDay = dayOf(today);
  const monday = todayDay - ((todayDay + 3) % 7); // day index of this week's Monday
  const weeks = Array.from({ length: WEEKS }, (_, i) => monday + i * 7);
  const projectName = Object.fromEntries(rows.map((r) => [r.id, r.name]));

  type Cell = { count: number; overdue: number };
  const people = new Map<
    string,
    { key: string; name: string; cells: Cell[]; total: number; overdue: number }
  >();
  const ensure = (key: string, name: string) => {
    let p = people.get(key);
    if (!p) {
      p = { key, name, cells: weeks.map(() => ({ count: 0, overdue: 0 })), total: 0, overdue: 0 };
      people.set(key, p);
    }
    return p;
  };
  // Everyone on the clock shows up even with zero tasks — free capacity is information.
  for (const m of team ?? []) ensure(m.key, m.name);
  for (const r of rows) {
    if (r.health === "done") continue;
    for (const t of r.taskRows) {
      if (t.status === "done" || !t.dueDate) continue;
      const p = ensure(t.assignee?.key ?? "__unassigned", t.assignee?.name ?? "Unassigned");
      p.total += 1;
      const d = dayOf(t.dueDate);
      if (d < monday) {
        p.overdue += 1;
        continue;
      }
      const wi = Math.floor((d - monday) / 7);
      if (wi < WEEKS) p.cells[wi].count += 1;
    }
  }
  let list = [...people.values()].sort((a, b) => {
    if (a.key === "__unassigned") return 1;
    if (b.key === "__unassigned") return -1;
    return b.total - a.total || a.name.localeCompare(b.name);
  });
  if (mine) list = list.filter((p) => p.key === mine || p.key === "__unassigned");
  const teamByKey = Object.fromEntries((team ?? []).map((m) => [m.key, m]));
  const heat = (n: number) =>
    n === 0
      ? "bg-parchment-dark text-ink-faint"
      : n <= 2
        ? "bg-accent/25 text-ink"
        : n <= 4
          ? "bg-accent/50 text-white"
          : n <= 5
            ? "bg-accent/80 text-white"
            : "bg-red-500 text-white";
  const hrs = (ms: number) => Math.round(ms / 360_000) / 10;

  return (
    <div className="glass-panel rounded-xl border border-line p-4 overflow-x-auto">
      <div className="min-w-[56rem]">
        <div className="flex h-5 mb-1 text-[10px] text-ink-faint">
          <div style={{ width: NAME_W }} className="shrink-0 uppercase tracking-wide">
            Team member
          </div>
          <div className="flex flex-1 gap-0.5">
            {weeks.map((w) => (
              <div key={w} className="flex-1 text-center whitespace-nowrap">
                {new Date(w * DAY).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })}
              </div>
            ))}
          </div>
          <div style={{ width: SIDE_W }} className="shrink-0 text-right uppercase tracking-wide">
            Now · this week
          </div>
        </div>

        {list.length === 0 && (
          <p className="py-8 text-center text-[13px] text-ink-faint">
            No open dated tasks assigned yet.
          </p>
        )}

        {list.map((p) => {
          const tm = teamByKey[p.key];
          const isUn = p.key === "__unassigned";
          return (
            <div
              key={p.key}
              className="flex items-center h-11 border-t border-line/60 first:border-t-0"
            >
              <div
                style={{ width: NAME_W }}
                className="shrink-0 flex items-center gap-2.5 pr-2 min-w-0"
              >
                {isUn ? (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-parchment-dark text-[11px] text-ink-faint">
                    ?
                  </span>
                ) : (
                  <Avatar
                    person={p}
                    profile={profiles[p.key]}
                    live={!!tm?.activeProjectId}
                    size={24}
                  />
                )}
                <div className="min-w-0 leading-tight">
                  <div
                    className={`text-[12.5px] font-medium truncate ${isUn ? "text-ink-soft" : ""}`}
                  >
                    {p.name}
                  </div>
                  <div className="text-[10.5px] text-ink-faint truncate">
                    {isUn ? "tasks with no owner" : (profiles[p.key]?.role ?? `${p.total} open`)}
                  </div>
                </div>
              </div>
              <div className="flex flex-1 gap-0.5 h-7">
                {p.cells.map((c, i) => (
                  <div
                    key={i}
                    className={`flex flex-1 items-center justify-center rounded text-[10.5px] font-semibold ${isUn && c.count ? "bg-red-500/70 text-white" : heat(c.count)}`}
                    title={`${c.count} open task${c.count === 1 ? "" : "s"} due week of ${new Date(weeks[i] * DAY).toLocaleDateString()}`}
                  >
                    {c.count || "–"}
                  </div>
                ))}
              </div>
              <div
                style={{ width: SIDE_W }}
                className="shrink-0 flex items-center justify-between gap-2 pl-3 text-[11px] whitespace-nowrap"
              >
                {isUn ? (
                  <span className="text-red-500 font-medium">
                    {p.total ? `${p.total} task${p.total === 1 ? "" : "s"} need an owner` : "—"}
                  </span>
                ) : (
                  <>
                    <span
                      className={`truncate ${tm?.activeProjectId ? "text-green-600 dark:text-green-400" : "text-ink-faint"}`}
                      title={
                        tm?.activeProjectId
                          ? `Clocked into ${projectName[tm.activeProjectId] ?? tm.activeProjectId}`
                          : undefined
                      }
                    >
                      {tm?.activeProjectId
                        ? `● ${(projectName[tm.activeProjectId] ?? "…").slice(0, 14)}`
                        : team
                          ? "○ standby"
                          : ""}
                      {p.overdue > 0 && (
                        <span className="ml-1.5 text-red-500">{p.overdue} overdue</span>
                      )}
                    </span>
                    <span className="text-ink-soft">{tm ? `${hrs(tm.weekMs)} h` : ""}</span>
                  </>
                )}
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[10px] text-ink-faint">
          <span>cells = open tasks due that week</span>
          <span>
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500 align-[-1px]" /> more
            than 5 in a week
          </span>
          <span>overdue = due before this Monday and still open</span>
          {team ? (
            <span>● = clocked in now · hours = this week from the timeclock</span>
          ) : (
            <span>connect the timeclock to see who is working now</span>
          )}
        </div>
      </div>
    </div>
  );
}
