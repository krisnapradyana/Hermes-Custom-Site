"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * "Time spent by project" — three donuts (today / this week / this month),
 * leadership request: at-a-glance distribution of where the studio's hours
 * go, as pies. All AGGREGATE data — no per-member figures.
 *
 * The label problem (long project names on pie slices) is solved by never
 * labeling slices: the donut center swaps to the hovered slice's numbers,
 * a peek strip shows the full name, everything else focus-dims, and clicking
 * a real project navigates to it.
 */

const STANDBY_ID = "standby";
const GENERAL_ID = "general";
const GENERAL_COLOR = "#14b8a6";
const STANDBY_COLOR = "#8b5cf6";
const OTHERS_COLOR = "#8a93a3";

interface Slice {
  id: string; // projectId, "standby", "general", or "others"
  name: string;
  ms: number;
  color: string;
  /** For the Others slice: what's inside. */
  contains?: string[];
}

const fmtH = (ms: number): string => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  if (h === 0 && m === 0) return "0m";
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Fold a projectId→ms map into donut slices: top N + General/Standby + Others. */
function buildSlices(
  byProject: Record<string, number>,
  projectInfo: Record<string, { name: string; color: string }>,
  topN = 4
): Slice[] {
  const entries = Object.entries(byProject).filter(([, ms]) => ms > 0);
  const pseudo: Slice[] = [];
  const real: { id: string; ms: number }[] = [];
  for (const [id, ms] of entries) {
    if (id === GENERAL_ID) pseudo.push({ id, name: "General duty", ms, color: GENERAL_COLOR });
    else if (id === STANDBY_ID) pseudo.push({ id, name: "Standby", ms, color: STANDBY_COLOR });
    else real.push({ id, ms });
  }
  real.sort((a, b) => b.ms - a.ms);
  const top: Slice[] = real.slice(0, topN).map((r) => ({
    id: r.id,
    name: projectInfo[r.id]?.name ?? "Deleted project",
    ms: r.ms,
    color: projectInfo[r.id]?.color ?? "#666a75",
  }));
  const rest = real.slice(topN);
  const slices: Slice[] = [...top, ...pseudo.sort((a, b) => b.ms - a.ms)];
  if (rest.length > 0) {
    slices.push({
      id: "others",
      name: `Others — ${rest.length} project${rest.length === 1 ? "" : "s"}`,
      ms: rest.reduce((a, r) => a + r.ms, 0),
      color: OTHERS_COLOR,
      contains: rest.slice(0, 6).map((r) => projectInfo[r.id]?.name ?? "Deleted project"),
    });
  }
  return slices;
}

function Donut({
  title,
  slices,
  people,
  onPeek,
}: {
  title: string;
  slices: Slice[];
  people: number;
  onPeek: (s: (Slice & { pct: number }) | null) => void;
}) {
  const router = useRouter();
  const [focus, setFocus] = useState<string | null>(null);
  const total = slices.reduce((a, s) => a + s.ms, 0);
  const C = 2 * Math.PI * 15.9; // ≈ 99.9 — dasharray practically in percent

  const focused = slices.find((s) => s.id === focus);
  const centerTop = focused ? fmtH(focused.ms) : fmtH(total);
  const centerMid = focused
    ? `${total > 0 ? Math.round((focused.ms / total) * 100) : 0}%`
    : title;
  const centerBot = focused
    ? focused.name.length > 20
      ? `${focused.name.slice(0, 20)}…`
      : focused.name
    : people > 0 && total > 0
      ? `≈ ${fmtH(Math.round(total / people))} / person`
      : "";

  let acc = 0;
  return (
    <div className="text-center">
      <p className="mb-1.5 text-[12px] font-medium text-ink-soft">{title}</p>
      {total === 0 ? (
        <div className="flex h-[132px] w-[132px] items-center justify-center rounded-full border border-line text-[11px] text-ink-faint">
          no time yet
        </div>
      ) : (
        <svg
          width="132"
          height="132"
          viewBox="0 0 42 42"
          className="overflow-visible"
          onMouseLeave={() => {
            setFocus(null);
            onPeek(null);
          }}
          role="img"
        >
          <title>{title} — time by project</title>
          {slices.map((s) => {
            const frac = s.ms / total;
            const dash = frac * C;
            // Start at 12 o'clock (C/4), advance by the cumulative fraction.
            const offset = C / 4 - (acc / total) * C;
            const el = (
              <circle
                key={s.id}
                cx="21"
                cy="21"
                r="15.9"
                fill="none"
                stroke={s.color}
                strokeWidth={focus === s.id ? 7.6 : 6.5}
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={offset}
                className="cursor-pointer transition-[opacity,stroke-width] duration-150"
                style={{ opacity: focus && focus !== s.id ? 0.18 : 1 }}
                onMouseEnter={() => {
                  setFocus(s.id);
                  onPeek({ ...s, pct: Math.round(frac * 100) });
                }}
                onClick={() => {
                  if (s.id !== "others" && s.id !== GENERAL_ID && s.id !== STANDBY_ID) {
                    router.push(`/projects/${encodeURIComponent(s.id)}`);
                  }
                }}
              />
            );
            acc += s.ms;
            return el;
          })}
          <text
            x="21"
            y={centerBot ? 19 : 21.5}
            textAnchor="middle"
            className="fill-ink"
            style={{ fontSize: "6.2px", fontWeight: 600 }}
          >
            {centerTop}
          </text>
          <text x="21" y="24.5" textAnchor="middle" className="fill-ink-faint" style={{ fontSize: "3.1px" }}>
            {centerMid}
          </text>
          {centerBot && (
            <text x="21" y="28.5" textAnchor="middle" className="fill-ink-faint" style={{ fontSize: "3.1px" }}>
              {centerBot}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}

export function TimeSpentPies({
  todayByProject,
  weekByProject,
  monthByProject,
  projectInfo,
  people,
}: {
  todayByProject: Record<string, number>;
  weekByProject: Record<string, number>;
  monthByProject: Record<string, number>;
  projectInfo: Record<string, { name: string; color: string }>;
  people: number;
}) {
  const [peek, setPeek] = useState<(Slice & { pct: number }) | null>(null);

  const pies = useMemo(
    () => [
      { title: "Today", slices: buildSlices(todayByProject, projectInfo) },
      { title: "This week", slices: buildSlices(weekByProject, projectInfo) },
      {
        title: `${new Date().toLocaleDateString(undefined, { month: "long" })} · cumulative`,
        slices: buildSlices(monthByProject, projectInfo),
      },
    ],
    [todayByProject, weekByProject, monthByProject, projectInfo]
  );

  if (pies.every((p) => p.slices.length === 0)) return null;

  return (
    <div className="glass-panel mb-5 rounded-2xl border border-line px-5 py-4">
      <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
        Time spent by project
      </p>
      <div className="flex flex-wrap items-start justify-around gap-x-8 gap-y-4">
        {pies.map((p) => (
          <Donut key={p.title} title={p.title} slices={p.slices} people={people} onPeek={setPeek} />
        ))}
      </div>
      {/* Peek strip — full names never get cut, whatever their length. */}
      <div className="mt-3 min-h-[2.25rem] rounded-xl border border-line/60 bg-parchment-dark/40 px-3.5 py-2 text-[12px]">
        {peek ? (
          <span>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: peek.color }} />
            <span className="font-medium">{peek.name}</span>
            <span className="text-ink-soft">
              {" "}
              · {fmtH(peek.ms)} · {peek.pct}% of that period
              {peek.contains ? ` — includes ${peek.contains.join(", ")}` : ""}
              {peek.id !== "others" && peek.id !== "general" && peek.id !== "standby"
                ? " · click the slice to open the project"
                : ""}
            </span>
          </span>
        ) : (
          <span className="text-ink-faint">
            Hover a slice to peek — the rest fades back. Click a project slice to open it.
          </span>
        )}
      </div>
    </div>
  );
}
