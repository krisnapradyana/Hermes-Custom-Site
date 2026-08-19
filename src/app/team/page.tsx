"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, FolderKanban, Coffee, ChevronDown, ChevronRight, ListChecks } from "lucide-react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";

/**
 * Team Pulse — the PM's one-glance answer to "who is busy, who is not".
 * Working members first (green pulse, project, since when), idle members
 * below (last seen). Hours today / this week per person, with a thin
 * relative-load bar. Data comes from the clock app via /api/team.
 */

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
  active: { projectId: string; inAt: string } | null;
  todayMs: number;
  weekMs: number;
  lastSeen: string | null;
  weekByProject: { projectId: string; ms: number }[];
  tasks: MemberTask[];
}

const STATUS_CLS: Record<MemberTask["status"], string> = {
  todo: "bg-parchment-dark text-ink-soft",
  doing: "bg-accent-soft text-accent",
  review: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  revision: "bg-red-500/10 text-red-500",
  done: "bg-green-500/15 text-green-600 dark:text-green-400",
};

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

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

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
    return () => clearInterval(t);
  }, [load]);

  const maxWeek = Math.max(1, ...(data?.members.map((m) => m.weekMs) ?? [1]));
  const working = data?.members.filter((m) => m.active) ?? [];
  const idle = data?.members.filter((m) => !m.active) ?? [];

  const projectName = (id: string) => data?.projects[id]?.name ?? id;
  const projectColor = (id: string) => data?.projects[id]?.color ?? "#888888";

  const row = (m: MemberPulse) => (
    <div key={m.userKey} className="rounded-xl border border-line bg-card px-4 py-3">
      <div
        className="flex items-center gap-3 cursor-pointer select-none"
        onClick={() => setExpanded(expanded === m.userKey ? null : m.userKey)}
        title="Click for details"
      >
        {/* status dot */}
        {m.active ? (
          <span className="relative flex h-2.5 w-2.5 shrink-0" title="Working now">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
        ) : (
          <span
            className="inline-flex h-2.5 w-2.5 rounded-full bg-ink-faint/40 shrink-0"
            title="Idle"
          />
        )}

        <div className="flex-1 min-w-0">
          <p className="font-medium text-[15px] truncate">{m.name}</p>
          {m.active ? (
            <p className="text-[12px] text-ink-soft truncate">
              <FolderKanban
                size={11}
                className="inline mr-1 -mt-0.5"
                style={{ color: projectColor(m.active.projectId) }}
              />
              {projectName(m.active.projectId)}
              <span className="text-ink-faint"> · since {fmtSince(m.active.inAt)}</span>
            </p>
          ) : (
            <p className="text-[12px] text-ink-faint truncate">
              <Coffee size={11} className="inline mr-1 -mt-0.5" />
              {m.lastSeen ? `last seen ${timeAgo(m.lastSeen)}` : "never clocked in"}
            </p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-[13px] font-medium tabular-nums">{fmtH(m.todayMs)}</p>
          <p className="text-[11px] text-ink-faint tabular-nums">{fmtH(m.weekMs)} this week</p>
        </div>
        {expanded === m.userKey ? (
          <ChevronDown size={14} className="text-ink-faint shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-ink-faint shrink-0" />
        )}
      </div>

      {/* relative weekly load + per-project split */}
      {m.weekMs > 0 && (
        <div className="mt-2.5">
          <div className="h-1.5 rounded-full bg-parchment-dark overflow-hidden flex">
            {m.weekByProject.map((w) => (
              <div
                key={w.projectId}
                title={`${projectName(w.projectId)} — ${fmtH(w.ms)}`}
                style={{
                  width: `${(w.ms / maxWeek) * 100}%`,
                  backgroundColor: projectColor(w.projectId),
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Expanded detail — what exactly is this person on. */}
      {expanded === m.userKey && (
        <div className="mt-3 pt-3 border-t border-line grid gap-4 sm:grid-cols-2">
          <div>
            <h4 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-1.5">
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
                    <span className="flex-1 min-w-0 truncate">{projectName(w.projectId)}</span>
                    <span className="tabular-nums text-ink-soft shrink-0">{fmtH(w.ms)}</span>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <h4 className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint mb-1.5">
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
                    className={`rounded-full px-1.5 py-0.5 text-[10px] shrink-0 ${STATUS_CLS[t.status]}`}
                  >
                    {t.status}
                  </span>
                  <span className="flex-1 min-w-0 truncate" title={t.title}>
                    {t.title}
                  </span>
                  <span className="text-[11px] text-ink-faint truncate max-w-[8rem] shrink-0">
                    {projectName(t.projectId)}
                    {t.dueDate
                      ? ` · ${new Date(`${t.dueDate}T00:00:00`).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
          <Users size={17} className="text-accent" />
        </div>
        <div>
          <h1 className="font-serif-display text-3xl">Team</h1>
        </div>
      </div>
      <p className="text-sm text-ink-soft mb-8">
        Live from the clock — who is working on what right now, and everyone&apos;s load.
      </p>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500">
          {error}
        </p>
      )}
      {!data && !error && <p className="text-sm text-ink-faint py-10 text-center">Loading…</p>}

      {data && data.members.length === 0 && (
        <p className="text-sm text-ink-faint text-center py-10">
          No clock activity yet — once people clock in at the clock app, they appear here.
        </p>
      )}

      {working.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-faint mb-2.5">
            Working now · {working.length}
          </h2>
          <div className="space-y-2.5">{working.map(row)}</div>
        </section>
      )}

      {idle.length > 0 && (
        <section>
          <h2 className="text-[12px] font-medium uppercase tracking-wide text-ink-faint mb-2.5">
            Not clocked in · {idle.length}
          </h2>
          <div className="space-y-2.5">{idle.map(row)}</div>
        </section>
      )}
    </div>
  );
}
