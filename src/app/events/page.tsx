"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
  MapPin,
  Video,
  Users,
  Repeat,
  ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/api";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

/**
 * Events — read-only company Google Calendar, visually cloned from Google:
 * month grid (pills, today ring, "+N more"), click a day → 24-hour grid,
 * click an event → floating detail card. The rail Google keeps on the LEFT
 * lives on our RIGHT (our left is the app sidebar): mini calendar +
 * calendar visibility toggles.
 */

interface Cal {
  id: string;
  name: string;
  color: string;
  primary: boolean;
}
interface Ev {
  id: string;
  calendarId: string;
  color: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  meet?: string;
  recurring: boolean;
  organizer?: string;
  attendees?: { email: string; name?: string; status?: string }[];
}

const DAY = 86_400_000;
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** All-day dates arrive as YYYY-MM-DD — parse as LOCAL, not UTC. */
const parseWhen = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
const fmtTime = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
const HIDDEN_KEY = "events-hidden-calendars";

export default function EventsPage() {
  // cursor = first day of the visible month; selectedDay drives the day view.
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [data, setData] = useState<{ configured: boolean; calendars: Cal[]; events: Ev[] } | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  const [popover, setPopover] = useState<{ ev: Ev; x: number; y: number } | null>(null);

  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"));
    } catch {}
  }, []);
  const toggleCal = (id: string) =>
    setHidden((h) => {
      const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

  // Visible grid = 6 weeks starting the Sunday on/before the 1st.
  const gridStart = useMemo(() => addDays(cursor, -cursor.getDay()), [cursor]);
  const gridEnd = useMemo(() => addDays(gridStart, 42), [gridStart]);

  const load = useCallback(async () => {
    const res = await api.get<{ configured: boolean; calendars: Cal[]; events: Ev[] }>(
      `/api/events?from=${encodeURIComponent(gridStart.toISOString())}&to=${encodeURIComponent(gridEnd.toISOString())}`
    );
    if (res.ok) {
      setData(res.data);
      setError("");
    } else setError(res.error);
  }, [gridStart, gridEnd]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useFocusRefresh(load);
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 120_000);
    return () => clearInterval(t);
  }, [load]);

  const visibleEvents = useMemo(
    () => (data?.events ?? []).filter((e) => !hidden.includes(e.calendarId)),
    [data, hidden]
  );

  /** Events shown in a day cell: all-day covering it + timed starting on it. */
  const eventsOn = useCallback(
    (day: Date) => {
      const d0 = startOfDay(day).getTime();
      const list = visibleEvents.filter((e) => {
        const s = parseWhen(e.start);
        if (e.allDay) {
          const end = parseWhen(e.end).getTime(); // exclusive
          return d0 >= startOfDay(s).getTime() && d0 < end;
        }
        return sameDay(s, day);
      });
      return list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return parseWhen(a.start).getTime() - parseWhen(b.start).getTime();
      });
    },
    [visibleEvents]
  );

  const openPopover = (ev: Ev, e: React.MouseEvent) => {
    e.stopPropagation();
    setPopover({
      ev,
      x: Math.min(e.clientX, window.innerWidth - 400),
      y: Math.min(e.clientY, window.innerHeight - 380),
    });
  };

  const today = new Date();
  const monthTitle = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const tzOffset = -new Date().getTimezoneOffset() / 60;

  const notConfigured = data && !data.configured;

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 flex flex-col px-6 py-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
            <CalendarDays size={17} className="text-accent" />
          </div>
          {selectedDay ? (
            <>
              <button
                onClick={() => setSelectedDay(null)}
                className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-ink-soft hover:border-ink-faint hover:text-ink"
              >
                <ArrowLeft size={13} />
                Month
              </button>
              <h1 className="font-serif-display text-2xl">
                {selectedDay.toLocaleDateString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </h1>
            </>
          ) : (
            <>
              <h1 className="font-serif-display text-2xl">{monthTitle}</h1>
              <div className="flex items-center gap-1 ml-2">
                <button
                  onClick={() => {
                    const n = new Date();
                    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
                  }}
                  className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:border-ink-faint hover:text-ink"
                >
                  Today
                </button>
                <button
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                  className="p-1.5 rounded-lg text-ink-soft hover:bg-parchment-dark"
                  title="Previous month"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                  className="p-1.5 rounded-lg text-ink-soft hover:bg-parchment-dark"
                  title="Next month"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[13px] text-red-500 shrink-0">
            {error}
          </p>
        )}

        {notConfigured && (
          <div className="rounded-xl border border-line bg-card p-6 text-center">
            <p className="text-sm font-medium mb-1">The company calendar isn&apos;t connected yet</p>
            <p className="text-[13px] text-ink-faint">
              The server reads Hermes&apos; Google credentials (documents/token.json). If this
              shows after a rebuild, check that file — or ask an engineer.
            </p>
          </div>
        )}

        {!data && !error && <p className="text-sm text-ink-faint py-10 text-center">Loading…</p>}

        {/* ── MONTH VIEW ─────────────────────────────────────────────── */}
        {data && data.configured && !selectedDay && (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-line bg-card overflow-hidden">
            <div className="grid grid-cols-7 border-b border-line shrink-0">
              {DOW.map((d) => (
                <div key={d} className="py-1.5 text-center text-[10.5px] font-medium tracking-wider text-ink-faint">
                  {d}
                </div>
              ))}
            </div>
            <div className="flex-1 grid grid-cols-7 grid-rows-6 min-h-0">
              {Array.from({ length: 42 }, (_, i) => {
                const day = addDays(gridStart, i);
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = sameDay(day, today);
                const evs = eventsOn(day);
                const shown = evs.slice(0, 3);
                return (
                  <div
                    key={i}
                    onClick={() => setSelectedDay(day)}
                    className={`border-b border-r border-line/60 px-1 py-1 min-h-0 overflow-hidden cursor-pointer hover:bg-parchment-dark/30 transition-colors ${
                      inMonth ? "" : "opacity-40"
                    }`}
                  >
                    <div className="flex justify-center mb-0.5">
                      <span
                        className={`text-[11.5px] w-6 h-6 flex items-center justify-center rounded-full ${
                          isToday ? "bg-accent text-white font-medium" : "text-ink-soft"
                        }`}
                      >
                        {day.getDate() === 1
                          ? day.toLocaleDateString(undefined, { month: "short", day: "numeric" })
                          : day.getDate()}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {shown.map((ev) =>
                        ev.allDay ? (
                          <div
                            key={ev.id}
                            onClick={(e) => openPopover(ev, e)}
                            className="rounded px-1.5 py-0.5 text-[10.5px] text-white truncate"
                            style={{ backgroundColor: ev.color }}
                            title={ev.title}
                          >
                            {ev.title}
                          </div>
                        ) : (
                          <div
                            key={ev.id}
                            onClick={(e) => openPopover(ev, e)}
                            className="flex items-center gap-1 px-1 text-[10.5px] text-ink-soft hover:bg-parchment-dark rounded truncate"
                            title={ev.title}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: ev.color }}
                            />
                            <span className="text-ink-faint shrink-0">
                              {fmtTime(parseWhen(ev.start))}
                            </span>
                            <span className="truncate">{ev.title}</span>
                          </div>
                        )
                      )}
                      {evs.length > shown.length && (
                        <div className="px-1 text-[10px] text-ink-faint">
                          +{evs.length - shown.length} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── DAY VIEW (24h grid) ────────────────────────────────────── */}
        {data && data.configured && selectedDay && (
          <div className="flex-1 min-h-0 rounded-xl border border-line bg-card overflow-y-auto">
            {/* all-day strip */}
            {eventsOn(selectedDay).filter((e) => e.allDay).length > 0 && (
              <div className="sticky top-0 z-10 border-b border-line bg-card px-14 py-1.5 space-y-1">
                {eventsOn(selectedDay)
                  .filter((e) => e.allDay)
                  .map((ev) => (
                    <div
                      key={ev.id}
                      onClick={(e) => openPopover(ev, e)}
                      className="rounded px-2 py-0.5 text-[11.5px] text-white truncate cursor-pointer w-fit min-w-40"
                      style={{ backgroundColor: ev.color }}
                    >
                      {ev.title}
                    </div>
                  ))}
              </div>
            )}
            <div className="relative" style={{ height: 24 * 48 }}>
              <span className="absolute left-2 top-1 text-[9.5px] text-ink-faint">
                GMT{tzOffset >= 0 ? "+" : ""}
                {tzOffset}
              </span>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-line/50"
                  style={{ top: h * 48 }}
                >
                  {h > 0 && (
                    <span className="absolute -top-2 left-2 text-[10px] text-ink-faint bg-card px-0.5">
                      {h % 12 === 0 ? 12 : h % 12} {h < 12 ? "AM" : "PM"}
                    </span>
                  )}
                </div>
              ))}
              {sameDay(selectedDay, today) && (
                <div
                  className="absolute left-12 right-2 h-0.5 bg-red-500 z-10"
                  style={{ top: (today.getHours() * 60 + today.getMinutes()) * 0.8 }}
                />
              )}
              {eventsOn(selectedDay)
                .filter((e) => !e.allDay)
                .map((ev) => {
                  const s = parseWhen(ev.start);
                  const en = parseWhen(ev.end);
                  const top = (s.getHours() * 60 + s.getMinutes()) * 0.8;
                  const height = Math.max(24, ((en.getTime() - s.getTime()) / 60000) * 0.8);
                  return (
                    <div
                      key={ev.id}
                      onClick={(e) => openPopover(ev, e)}
                      className="absolute left-14 right-4 rounded-md px-2 py-1 text-[11.5px] text-white cursor-pointer overflow-hidden border border-black/20"
                      style={{ top, height, backgroundColor: ev.color }}
                      title={ev.title}
                    >
                      <span className="font-medium">{ev.title}</span>
                      <span className="opacity-80">
                        {" "}
                        · {fmtTime(s)} – {fmtTime(en)}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT RAIL: mini calendar + calendar toggles ─────────────── */}
      <aside className="hidden lg:flex w-64 shrink-0 border-l border-line flex-col gap-5 px-4 py-6">
        <MiniCalendar
          cursor={cursor}
          today={today}
          selected={selectedDay}
          onMonth={(d) => setCursor(d)}
          onPick={(d) => {
            setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
            setSelectedDay(d);
          }}
        />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint mb-2">
            Calendars
          </p>
          <div className="space-y-1.5">
            {(data?.calendars ?? []).map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 text-[12.5px] cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={!hidden.includes(c.id)}
                  onChange={() => toggleCal(c.id)}
                  style={{ accentColor: c.color }}
                />
                <span className="truncate" title={c.name}>
                  {c.name}
                </span>
              </label>
            ))}
            {data && data.configured && data.calendars.length === 0 && (
              <p className="text-[12px] text-ink-faint">No calendars visible.</p>
            )}
          </div>
        </div>
        <p className="mt-auto text-[10.5px] text-ink-faint">
          Read-only · company Google Calendar · events with the company email invited appear here
        </p>
      </aside>

      {/* ── FLOATING EVENT DETAILS ───────────────────────────────────── */}
      {popover && (
        <div className="fixed inset-0 z-50" onClick={() => setPopover(null)}>
          <div
            className="absolute w-[380px] max-w-[92vw] rounded-2xl border border-line bg-card shadow-xl p-4"
            style={{ left: popover.x, top: popover.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2.5">
              <span
                className="w-3.5 h-3.5 rounded mt-1 shrink-0"
                style={{ backgroundColor: popover.ev.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[16px] font-medium leading-snug">{popover.ev.title}</p>
                <p className="text-[12.5px] text-ink-soft mt-0.5">
                  {parseWhen(popover.ev.start).toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                  {!popover.ev.allDay && (
                    <>
                      {" · "}
                      {fmtTime(parseWhen(popover.ev.start))} – {fmtTime(parseWhen(popover.ev.end))}
                    </>
                  )}
                  {popover.ev.allDay && " · All day"}
                </p>
                {popover.ev.recurring && (
                  <p className="flex items-center gap-1 text-[11.5px] text-ink-faint mt-0.5">
                    <Repeat size={11} /> Recurring
                  </p>
                )}
              </div>
              <button
                onClick={() => setPopover(null)}
                className="p-1 rounded-lg text-ink-faint hover:text-ink hover:bg-parchment-dark shrink-0"
              >
                <X size={15} />
              </button>
            </div>

            {popover.ev.meet && (
              <a
                href={popover.ev.meet}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] text-white hover:bg-accent-hover w-fit"
              >
                <Video size={14} />
                Join with Google Meet
              </a>
            )}
            {popover.ev.location && (
              <p className="mt-2.5 flex items-start gap-2 text-[12.5px] text-ink-soft">
                <MapPin size={13} className="mt-0.5 shrink-0 text-ink-faint" />
                {popover.ev.location}
              </p>
            )}
            {popover.ev.attendees && popover.ev.attendees.length > 0 && (
              <div className="mt-2.5">
                <p className="flex items-center gap-1.5 text-[11.5px] text-ink-faint mb-1">
                  <Users size={12} />
                  {popover.ev.attendees.length} guest{popover.ev.attendees.length > 1 ? "s" : ""}
                </p>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {popover.ev.attendees.map((a) => (
                    <div key={a.email} className="flex items-center gap-2 text-[12px]">
                      <span className="w-5 h-5 rounded-full bg-accent-soft text-accent text-[9px] flex items-center justify-center shrink-0 font-medium">
                        {(a.name ?? a.email).slice(0, 2).toUpperCase()}
                      </span>
                      <span className="truncate">{a.name ?? a.email}</span>
                      <span className="ml-auto text-[10.5px] text-ink-faint shrink-0">
                        {a.status === "accepted"
                          ? "going"
                          : a.status === "declined"
                            ? "declined"
                            : a.status === "tentative"
                              ? "maybe"
                              : "awaiting"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {popover.ev.description && (
              <p className="mt-2.5 text-[12px] text-ink-soft whitespace-pre-wrap line-clamp-5">
                {popover.ev.description}
              </p>
            )}
            {popover.ev.organizer && (
              <p className="mt-2.5 text-[11.5px] text-ink-faint">
                Organizer: {popover.ev.organizer}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The little month grid on the rail — Google's left panel, on our right. */
function MiniCalendar({
  cursor,
  today,
  selected,
  onMonth,
  onPick,
}: {
  cursor: Date;
  today: Date;
  selected: Date | null;
  onMonth: (d: Date) => void;
  onPick: (d: Date) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12.5px] font-medium">
          {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </p>
        <div className="flex items-center">
          <button
            onClick={() => onMonth(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="p-1 rounded text-ink-faint hover:text-ink"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            onClick={() => onMonth(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="p-1 rounded text-ink-faint hover:text-ink"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i} className="text-[9.5px] text-ink-faint py-0.5">
            {d}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const day = addDays(start, i);
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = sameDay(day, today);
          const isSel = selected ? sameDay(day, selected) : false;
          return (
            <button
              key={dateKey(day)}
              onClick={() => onPick(day)}
              className={`text-[10.5px] w-6 h-6 mx-auto rounded-full flex items-center justify-center transition-colors ${
                isToday
                  ? "bg-accent text-white"
                  : isSel
                    ? "bg-accent-soft text-accent"
                    : inMonth
                      ? "text-ink-soft hover:bg-parchment-dark"
                      : "text-ink-faint/50 hover:bg-parchment-dark"
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
