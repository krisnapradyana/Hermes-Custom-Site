"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Users, Coffee, ArrowUpRight } from "lucide-react";
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
        m.weekByProject.some((w) => w.projectId === projectId) ||
        m.tasks.some((t) => t.projectId === projectId && t.status !== "done")
    ) ?? [];

  // Working here first, then working elsewhere, then by hours here this week.
  const hoursHere = (m: MemberPulse) =>
    m.weekByProject.find((w) => w.projectId === projectId)?.ms ?? 0;
  const rank = (m: MemberPulse) =>
    m.active?.projectId === projectId ? 0 : m.active ? 1 : 2;
  const sorted = [...involved].sort((a, b) => rank(a) - rank(b) || hoursHere(b) - hoursHere(a));

  return (
    <div className="mb-8 rounded-xl border border-line bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Users size={14} className="text-accent" />
        <p className="text-sm font-medium">Team on this project</p>
        {data && (
          <span className="text-[12px] text-ink-faint">
            {sorted.filter((m) => m.active?.projectId === projectId).length} working now
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
          const elsewhere = m.active && !here ? m.active.projectId : null;
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
                ) : elsewhere ? (
                  <Link
                    prefetch={false}
                    href={`/projects/${encodeURIComponent(elsewhere)}`}
                    className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline truncate"
                    title="Open that project"
                  >
                    Currently working on {data?.projects[elsewhere]?.name ?? elsewhere}
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
                <p className="text-[13px] font-medium tabular-nums">{fmtH(hoursHere(m))}</p>
                <p className="text-[11px] text-ink-faint">this week here</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
