"use client";

import { useEffect, useMemo, useRef } from "react";

/**
 * Scrollable month-strip calendar for the Projects page. Spans 3 years back
 * to 1 month ahead, with the current month vertically centered on mount.
 * Days on which a project was CREATED are accent-colored and clickable —
 * clicking one filters the project list to that date. All other days are
 * inert. Months other than the current one are subtly dimmed, like a real
 * calendar app's minimap.
 */

const MONTHS_BACK = 36;
const MONTHS_AHEAD = 1;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** Local-timezone YYYY-MM-DD for an ISO timestamp — calendar days should
 *  match what the user's clock says, not UTC. */
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function ProjectCalendar({
  dates,
  selected,
  onSelect,
}: {
  /** local date key → number of projects created that day */
  dates: Map<string, number>;
  selected: string | null;
  onSelect: (dateKey: string | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLElement>(null);

  const months = useMemo(() => {
    const now = new Date();
    const list: { y: number; m: number; current: boolean }[] = [];
    for (let i = -MONTHS_BACK; i <= MONTHS_AHEAD; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      list.push({ y: d.getFullYear(), m: d.getMonth(), current: i === 0 });
    }
    return list;
  }, []);

  // Center the current month in the panel on mount.
  useEffect(() => {
    const box = scrollRef.current;
    const cur = currentRef.current;
    if (box && cur) {
      box.scrollTop = cur.offsetTop - box.clientHeight / 2 + cur.clientHeight / 2;
    }
  }, []);

  const p = (n: number) => String(n).padStart(2, "0");
  const thisYear = new Date().getFullYear();

  return (
    <div ref={scrollRef} className="relative h-full overflow-y-auto px-5 py-6">
      {months.map(({ y, m, current }) => {
        const firstWeekday = (new Date(y, m, 1).getDay() + 6) % 7; // Monday = 0
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const label = new Date(y, m, 1).toLocaleString(undefined, { month: "long" });

        return (
          <section
            key={`${y}-${m}`}
            ref={current ? currentRef : undefined}
            className={`mb-6 ${current ? "" : "opacity-55"}`}
          >
            <h3 className="text-[13px] font-medium pb-1.5 mb-2 border-b border-line">
              {label}
              {y !== thisYear && <span className="text-ink-faint"> {y}</span>}
            </h3>
            <div className="grid grid-cols-7 gap-y-1 justify-items-center">
              {WEEKDAYS.map((w, i) => (
                <span key={`${w}-${i}`} className="text-[10px] text-ink-faint">
                  {w}
                </span>
              ))}
              {Array.from({ length: firstWeekday }, (_, i) => (
                <span key={`pad-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const key = `${y}-${p(m + 1)}-${p(day)}`;
                const count = dates.get(key) ?? 0;
                const isSelected = selected === key;

                if (count === 0) {
                  return (
                    <span
                      key={key}
                      className="w-7 h-7 flex items-center justify-center text-[11px] text-ink-faint"
                    >
                      {day}
                    </span>
                  );
                }
                return (
                  <button
                    key={key}
                    onClick={() => onSelect(isSelected ? null : key)}
                    title={`${count} project${count === 1 ? "" : "s"} created this day`}
                    className={`w-7 h-7 flex items-center justify-center text-[11px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors ${
                      isSelected
                        ? "rounded-lg ring-2 ring-accent/50 ring-offset-2 ring-offset-parchment"
                        : "rounded-full"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
