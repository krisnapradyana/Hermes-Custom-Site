"use client";

import { useMemo } from "react";
import { Diamond, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { useTimelineView, TIMELINE_HINT } from "@/lib/use-timeline-view";

/**
 * Project timeline — the pattern of Asana's Timeline (horizontal time axis,
 * week gridlines, TODAY line, rounded bars) with ftrack/ShotGrid semantics
 * (bars colored by pipeline phase, milestones as diamonds). Navigation is
 * Blender-style via useTimelineView: wheel zooms at the cursor, drag pans,
 * Fit returns to the full range.
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
    const fullFrom = Math.min(...days, todayDay) - 2;
    const fullTo = Math.max(...days, todayDay) + 3;

    const milestones = dated.filter((t) => t.kind === "milestone");
    const bars = dated
      .filter((t) => t.kind !== "milestone")
      .sort((a, b) => dayOf(a.startDate ?? a.createdAt) - dayOf(b.startDate ?? b.createdAt));

    return { fullFrom, fullTo, milestones, bars, todayDay };
  }, [tasks, projectStart, projectDeadline]);

  // Hook must run unconditionally — feed it a dummy range when empty.
  const view = useTimelineView(model?.fullFrom ?? 0, model?.fullTo ?? 30);

  if (!model) return null;
  const { milestones, bars, todayDay } = model;
  const { pct, spanPct } = view;

  if (bars.length === 0 && milestones.length === 0 && !projectStart && !projectDeadline) {
    return null;
  }

  // Week tick marks (Mondays) inside the current view; label density adapts.
  const weeks: { day: number; label: string }[] = [];
  for (let d = view.from; d <= view.to; d++) {
    if ((d + 3) % 7 === 0) {
      weeks.push({
        day: d,
        label: new Date(d * DAY).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
      });
    }
  }
  const labelEvery = Math.max(1, Math.ceil(weeks.length / 10));

  const barColor = (t: TimelineTask) => PHASE_COLORS[t.phase ?? "Other"] ?? "#8a8a8a";

  return (
    <div className="mb-8 rounded-xl border border-line bg-card p-4 overflow-x-auto">
      <div className="min-w-[36rem]">
        {/* Zoom controls */}
        <div className="flex items-center justify-end gap-1 mb-1">
          <span className="text-[10px] text-ink-faint mr-1.5">{TIMELINE_HINT}</span>
          <button
            onClick={() => view.zoom(1.4)}
            className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-parchment-dark"
            title="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            onClick={() => view.zoom(1 / 1.4)}
            className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-parchment-dark"
            title="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <button
            onClick={view.fit}
            disabled={view.isFit}
            className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-parchment-dark disabled:opacity-30"
            title="Fit everything"
          >
            <Maximize size={13} />
          </button>
        </div>

        <div ref={view.canvasRef} {...view.canvasProps} className="relative">
          {/* Week gridlines + labels */}
          <div className="relative h-5 mb-1 overflow-hidden">
            {weeks.map(
              (w, i) =>
                i % labelEvery === 0 && (
                  <span
                    key={w.day}
                    className="absolute top-0 -translate-x-1/2 text-[10px] text-ink-faint whitespace-nowrap"
                    style={{ left: `${pct(w.day)}%` }}
                  >
                    {w.label}
                  </span>
                )
            )}
          </div>

          <div className="relative rounded-lg bg-parchment-dark/40 py-2 overflow-hidden">
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
                    // width) and let the label flow right.
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
            {todayDay >= view.from && todayDay <= view.to && (
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
