"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Users, Coffee, ArrowUpRight, Armchair } from "lucide-react";

/** Clock app's pseudo-project for "present, no project". */
const STANDBY_ID = "standby";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

/**
 * Who is (or was) on THIS project — a project-scoped slice of Team Pulse.
 * Green pulse = clocked into this project right now. Members clocked into a
 * DIFFERENT project get a clickable "Currently working on X" chip that jumps
 * there. Everyone else shows last-seen. Membership = clocked time on this
 * project this week, an open task here, or currently active here.
 */

interface MemberTask {
  id: string;
  projectId: string;
  status: "todo" | "doing" | "review" | "revision" | "done";
}

interface MemberPulse {
  userKey: string;
  name: string;
  active: { projectId: string; inAt: string; breakAt?: string } | null;
  todayMs: number;
  weekMs: number;
  lastSeen: string | null;
  weekByProject: { projectId: string; ms: number }[];
  todayByProject?: { projectId: string; ms: number }[];
  totalByProject?: { projectId: string; ms: number }[];
  tasks: MemberTask[];
}

interface TeamData {
  members: MemberPulse[];
  projects: Record<string, { name: string; color: string }>;
}

const fmtH = (ms: number): string => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h === 0 && m === 0) return "—";
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const fmtSince = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export function ProjectTeam({ projectId }: { projectId: string }) {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState("");

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
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);
  useFocusRefresh(load);

  if (error) return null; // clock app not configured/reachable — stay out of the way

  const involved =
    data?.members.filter(
      (m) =>
        m.active?.projectId === projectId ||
        (m.totalByProject ?? []).some((w) => w.projectId === projectId) ||
        m.weekByProject.some((w) => w.projectId === projectId) ||
        m.tasks.some((t) => t.projectId === projectId && t.status !== "done")
    ) ?? [];

  // Per-member time on THIS project. Total = all-time man-hours (the brief's
  // primary metric); week/today stay as secondary context.
  const weekHere = (m: MemberPulse) =>
    m.weekByProject.find((w) => w.projectId === projectId)?.ms ?? 0;
  const todayHere = (m: MemberPulse) =>
    (m.todayByProject ?? []).find((w) => w.projectId === projectId)?.ms ?? 0;
  const totalHere = (m: MemberPulse) =>
    (m.totalByProject ?? []).find((w) => w.projectId === projectId)?.ms ?? 0;
  const rank = (m: MemberPulse) =>
    m.active?.projectId === projectId ? 0 : m.active ? 1 : 2;
  const sorted = [...involved].sort((a, b) => rank(a) - rank(b) || totalHere(b) - totalHere(a));

  // Man-hours stats: concurrent work sums per person, so the project total
  // is simply the sum of individual totals.
  const manHours = sorted.reduce((acc, m) => acc + totalHere(m), 0);
  const contributors = sorted.filter((m) => totalHere(m) > 0).length;
  const activeNow = sorted.filter((m) => m.active?.projectId === projectId).length;

  return (
    <div className="mb-8">
      {/* Stat strip — the manager's one-glance answer. */}
      {data && sorted.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 mb-3">
          <div className="rounded-xl border border-line bg-card px-3.5 py-2.5">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
              Total man-hours
            </p>
            <p className="text-xl font-medium leading-tight mt-0.5 tabular-nums">{fmtH(manHours)}</p>
            <p className="text-[10.5px] text-ink-faint mt-0.5">total used</p>
          </div>
          <div className="rounded-xl border border-line bg-card px-3.5 py-2.5">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
              Contributors
            </p>
            <p className="text-xl font-medium leading-tight mt-0.5">{contributors}</p>
            <p className="text-[10.5px] text-ink-faint mt-0.5">people with recorded time</p>
          </div>
          <div className="rounded-xl border border-line bg-card px-3.5 py-2.5">
            <p className="text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
              Active now
            </p>
            <p className={`text-xl font-medium leading-tight mt-0.5 ${activeNow > 0 ? "text-green-600 dark:text-green-400" : ""}`}>
              {activeNow}
            </p>
            <p className="text-[10.5px] text-ink-faint mt-0.5">currently clocked in</p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Users size={14} className="text-accent" />
        <p className="text-sm font-medium">Team on this project</p>
        {data && (
          <span className="text-[12px] text-ink-faint">
            {activeNow} working now
          </span>
        )}
      </div>

      {!data && <p className="text-[13px] text-ink-faint py-1">Loading…</p>}
      {data && sorted.length === 0 && (
        <p className="text-[13px] text-ink-faint py-1">
          No one has clocked in or been assigned here yet.
        </p>
      )}

      <div className="space-y-1.5">
        {sorted.map((m) => {
          const here = m.active?.projectId === projectId;
          const onStandby = m.active?.projectId === STANDBY_ID;
          const elsewhere = m.active && !here && !onStandby ? m.active.projectId : null;
          const openHere = m.tasks.filter(
            (t) => t.projectId === projectId && t.status !== "done"
          ).length;
          return (
            <div key={m.userKey} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
              {here ? (
                <span className="relative flex h-2.5 w-2.5 shrink-0" title="Working on this now">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                </span>
              ) : onStandby ? (
                <span
                  className="inline-flex h-2.5 w-2.5 rounded-full bg-violet-500 shrink-0"
                  title="On standby — available for assignment"
                />
              ) : elsewhere ? (
                <span
                  className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0"
                  title="Working on another project"
                />
              ) : (
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-ink-faint/40 shrink-0" title="Idle" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium truncate">{m.name}</p>
                {here ? (
                  <p className="text-[12px] text-ink-soft truncate">
                    {m.active!.breakAt
                      ? `On break · since ${fmtSince(m.active!.breakAt)}`
                      : `Working on this now · since ${fmtSince(m.active!.inAt)}`}
                  </p>
                ) : onStandby ? (
                  <p className="text-[12px] truncate text-violet-600 dark:text-violet-400">
                    <Armchair size={11} className="inline mr-1 -mt-0.5" />
                    On standby — available for assignment
                  </p>
                ) : elsewhere ? (
                  <Link
                    prefetch={false}
                    href={`/projects/${encodeURIComponent(elsewhere)}`}
                    className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline truncate"
                    title="Open that project"
                  >
                    Currently working on {data?.projects[elsewhere]?.name ?? "a deleted project"}
                    <ArrowUpRight size={11} className="shrink-0" />
                  </Link>
                ) : (
                  <p className="text-[12px] text-ink-faint truncate">
                    <Coffee size={11} className="inline mr-1 -mt-0.5" />
                    {m.lastSeen ? `last seen ${timeAgo(m.lastSeen)}` : "never clocked in"}
                    {openHere > 0 && ` · ${openHere} open task${openHere > 1 ? "s" : ""} here`}
                  </p>
                )}
              </div>

              <div className="text-right shrink-0">
                <p className="text-[13.5px] font-medium tabular-nums text-accent">
                  {fmtH(totalHere(m))}{" "}
                  <span className="text-[11px] font-normal text-ink-faint">project</span>
                </p>
                <p className="text-[11px] text-ink-faint tabular-nums">
                  {todayHere(m) > 0 || weekHere(m) > 0
                    ? `${fmtH(todayHere(m))} today · ${fmtH(weekHere(m))} this week`
                    : "no time this week"}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
