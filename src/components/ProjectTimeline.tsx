"use client";

import { useMemo } from "react";
import { Diamond } from "lucide-react";

/**
 * Project timeline — the pattern of Asana's Timeline (horizontal time axis,
 * week gridlines, TODAY line, rounded bars) with ftrack/ShotGrid semantics
 * (bars colored by pipeline phase, milestones as diamonds). No dependency
 * engine — for a 20-person studio, phases + milestones are the 80%.
 *
 * Bars: startDate (or createdAt) → dueDate. Tasks without a dueDate don't
 * appear here — the board below still lists them.
 */

interface TimelineTask {
  id: string;
  kind?: "task" | "milestone";
  title: string;
  phase?: string;
  status: "todo" | "doing" | "review" | "revision" | "done";
  assignee?: { key: string; name: string };
  startDate?: string;
  dueDate?: string;
  createdAt: string;
}

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

export function ProjectTimeline({
  tasks,
  projectStart,
  projectDeadline,
}: {
  tasks: TimelineTask[];
  projectStart?: string;
  projectDeadline?: string;
}) {
  const model = useMemo(() => {
    const dated = tasks.filter((t) => t.dueDate);
    const todayDay = Math.floor((Date.now() + new Date().getTimezoneOffset() * -60000) / DAY);

    // Range: project schedule ∪ task dates, padded; sane fallback.
    const days: number[] = [];
    if (projectStart) days.push(dayOf(projectStart));
    if (projectDeadline) days.push(dayOf(projectDeadline));
    for (const t of dated) {
      days.push(dayOf(t.dueDate!));
      days.push(dayOf(t.startDate ?? t.createdAt));
    }
    if (days.length === 0) return null;
    const from = Math.min(...days, todayDay) - 2;
    const to = Math.max(...days, todayDay) + 3;
    const total = to - from + 1;

    const pct = (day: number) => ((day - from) / total) * 100;
    const spanPct = (a: number, b: number) => (Math.max(1, b - a + 1) / total) * 100;

    // Week tick marks (Mondays).
    const weeks: { day: number; label: string }[] = [];
    for (let d = from; d <= to; d++) {
      if ((d + 3) % 7 === 0) {
        weeks.push({
          day: d,
          label: new Date(d * DAY).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          }),
        });
      }
    }

    const milestones = dated.filter((t) => t.kind === "milestone");
    const bars = dated
      .filter((t) => t.kind !== "milestone")
      .sort((a, b) => dayOf(a.startDate ?? a.createdAt) - dayOf(b.startDate ?? b.createdAt));

    return { from, to, total, pct, spanPct, weeks, milestones, bars, todayDay };
  }, [tasks, projectStart, projectDeadline]);

  if (!model) return null;
  const { pct, spanPct, weeks, milestones, bars, todayDay, from, to } = model;

  if (bars.length === 0 && milestones.length === 0 && !projectStart && !projectDeadline) {
    return null;
  }

  const barColor = (t: TimelineTask) => PHASE_COLORS[t.phase ?? "Other"] ?? "#8a8a8a";

  return (
    <div className="mb-8 rounded-xl border border-line bg-card p-4 overflow-x-auto">
      <div className="min-w-[36rem] relative">
        {/* Week gridlines + labels */}
        <div className="relative h-5 mb-1">
          {weeks.map((w) => (
            <span
              key={w.day}
              className="absolute top-0 -translate-x-1/2 text-[10px] text-ink-faint whitespace-nowrap"
              style={{ left: `${pct(w.day)}%` }}
            >
              {w.label}
            </span>
          ))}
        </div>

        <div className="relative rounded-lg bg-parchment-dark/40 py-2">
          {weeks.map((w) => (
            <span
              key={w.day}
              className="absolute inset-y-0 w-px bg-line/60"
              style={{ left: `${pct(w.day)}%` }}
            />
          ))}

          {/* Project schedule band */}
          {projectStart && projectDeadline && (
            <div
              className="h-1 rounded-full bg-ink-faint/30 mx-0 mb-2 relative"
              style={{
                marginLeft: `${pct(dayOf(projectStart))}%`,
                width: `${spanPct(dayOf(projectStart), dayOf(projectDeadline))}%`,
              }}
              title={`Project: ${projectStart} → ${projectDeadline}`}
            />
          )}

          {/* Milestones row */}
          {milestones.length > 0 && (
            <div className="relative h-6 mb-1">
              {milestones.map((m) => (
                <div
                  key={m.id}
                  // Anchor the DIAMOND on the date (shift by half its 12px
                  // width) and let the label flow right — centering the whole
                  // diamond+label group dragged the diamond off its date by
                  // half the label width.
                  className="absolute top-0 flex items-center gap-1"
                  style={{ left: `${pct(dayOf(m.dueDate!))}%`, transform: "translateX(-6px)" }}
                  title={`${m.title} — ${m.dueDate}`}
                >
                  <Diamond
                    size={12}
                    className={m.status === "done" ? "text-green-500" : "text-accent"}
                    fill="currentColor"
                  />
                  <span className="text-[10px] text-ink-soft whitespace-nowrap max-w-[9rem] truncate">
                    {m.title}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Task bars */}
          <div className="space-y-1.5 py-1">
            {bars.map((t) => {
              const a = dayOf(t.startDate ?? t.createdAt);
              const b = dayOf(t.dueDate!);
              const overdue = t.status !== "done" && b < todayDay;
              return (
                <div key={t.id} className="relative h-5">
                  <div
                    className={`absolute inset-y-0 rounded-md flex items-center px-1.5 overflow-hidden ${
                      t.status === "done" ? "opacity-45" : ""
                    } ${overdue ? "ring-1 ring-red-500" : ""} ${
                      t.status === "revision" ? "ring-1 ring-red-400/70" : ""
                    }`}
                    style={{
                      left: `${pct(Math.min(a, b))}%`,
                      width: `${spanPct(Math.min(a, b), b)}%`,
                      backgroundColor: `${barColor(t)}cc`,
                    }}
                    title={`${t.title}${t.assignee ? ` — ${t.assignee.name}` : ""} · ${
                      t.startDate ?? t.createdAt.slice(0, 10)
                    } → ${t.dueDate}${overdue ? " · OVERDUE" : ""}`}
                  >
                    <span className="text-[10px] text-white font-medium truncate">
                      {t.title}
                      {t.assignee ? ` · ${t.assignee.name.split(" ")[0]}` : ""}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* TODAY line */}
          {todayDay >= from && todayDay <= to && (
            <div
              className="absolute inset-y-0 w-0.5 bg-accent"
              style={{ left: `${pct(todayDay)}%` }}
              title="Today"
            >
              <span className="absolute -top-0.5 left-1 text-[9px] font-medium text-accent">
                TODAY
              </span>
            </div>
          )}
        </div>

        {/* Phase legend — only phases in use */}
        <div className="flex flex-wrap gap-3 mt-2.5">
          {[...new Set(bars.map((t) => t.phase ?? "Other"))].map((ph) => (
            <span key={ph} className="flex items-center gap-1.5 text-[10px] text-ink-faint">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ backgroundColor: PHASE_COLORS[ph] ?? "#8a8a8a" }}
              />
              {ph}
            </span>
          ))}
          {milestones.length > 0 && (
            <span className="flex items-center gap-1.5 text-[10px] text-ink-faint">
              <Diamond size={9} className="text-accent" fill="currentColor" />
              Milestone
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
