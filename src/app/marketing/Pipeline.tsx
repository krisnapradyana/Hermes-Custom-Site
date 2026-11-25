"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CardPanel } from "./CardPanel";
import { ReviewQueue } from "./ReviewQueue";
import {
  BANK,
  PUBLIC_STAGES,
  type Board,
  type Card,
  FORMAT_CLS,
  chip,
  fmtDue,
  inputCls,
  isOverdue,
  needsResults,
  waitsOn,
  Avatar,
} from "./pipeline-shared";
import { BankGrid } from "./BankGrid";

/**
 * Content Pipeline — content pieces (one card per angle) moving
 * Angle → Drafting → Review → Scheduled → Published, shown as a board, a
 * table or a calendar. Clicking a card opens its detail panel (CardPanel):
 * brief, draft, assets, comments. Below the board sits the content bank —
 * ideas not scheduled yet. Cards linked to a radar project carry its posting
 * rules: Restricted blocks the last two stages (server enforced); "not
 * cleared" / "client hasn't published" ask for confirmation.
 */

type View = "board" | "table" | "calendar" | "review";

export function Pipeline({
  onRunChecker,
  initialOpenId,
}: {
  onRunChecker: (format: string, draft: string) => void;
  /** Card to open straight away (arriving from a project page). */
  initialOpenId?: string | null;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("board");
  const [format, setFormat] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/pipeline");
      if (!res.ok) throw new Error();
      setBoard(await res.json());
    } catch {
      setError("Could not load the pipeline — reload the page");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const projectOf = useCallback(
    (c: { projectId?: string }) => board?.projects.find((p) => p.id === c.projectId),
    [board]
  );

  /** Ask before a piece goes public while its project isn't clearly safe. */
  const okToGoPublic = useCallback(
    (c: { projectId?: string }, stage: string): boolean => {
      if (!PUBLIC_STAGES.includes(stage)) return true;
      const p = projectOf(c);
      if (!p || p.nda === "no") return true; // unlinked, or the server will refuse
      const issues = [
        p.nda !== "ok" ? "its NDA status has not been cleared" : "",
        !p.clientPublished ? "the client has not published it anywhere yet" : "",
      ].filter(Boolean);
      if (!issues.length) return true;
      return confirm(`"${p.name}": ${issues.join(" and ")}.\n\nMove this piece to ${stage} anyway?`);
    },
    [projectOf]
  );

  /** One place for every card change: optimistic, then the server's copy. */
  const send = useCallback(
    async (id: string, body: Record<string, unknown>, optimistic?: Partial<Card>): Promise<boolean> => {
      if (optimistic) {
        setBoard((b) => b && { ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, ...optimistic } : c)) });
      }
      try {
        const res = await fetch("/api/marketing/pipeline", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, ...body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Change was not saved");
        setBoard((b) => b && { ...b, cards: b.cards.map((c) => (c.id === id ? (data.card as Card) : c)) });
        setError(null);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Change was not saved");
        load();
        return false;
      }
    },
    [load]
  );

  const move = useCallback(
    (id: string, stage: string) => {
      const card = board?.cards.find((c) => c.id === id);
      if (!card || card.stage === stage || !okToGoPublic(card, stage)) return;
      send(id, { stage }, { stage });
    },
    [board, okToGoPublic, send]
  );

  const visible = useMemo(
    () =>
      (board?.cards ?? []).filter(
        (c) => (!format || c.format === format) && (!person || c.owner === person || c.reviewers.includes(person))
      ),
    [board, format, person]
  );
  const onBoard = useMemo(() => visible.filter((c) => c.stage !== BANK), [visible]);
  const bank = useMemo(
    () => visible.filter((c) => c.stage === BANK).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [visible]
  );
  const byDue = (a: Card, b: Card) =>
    (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.updatedAt.localeCompare(a.updatedAt);

  const people = useMemo(
    () => Array.from(new Set([...(board?.people ?? []), board?.me ?? ""].filter(Boolean))).sort(),
    [board]
  );
  const openCard = board?.cards.find((c) => c.id === openId) ?? null;
  const waitingOnMe = board ? board.cards.filter((c) => waitsOn(c, board.me)).length : 0;

  /** Cards waiting on the viewer's approval. */
  const needsMe = (c: Card) => !!board && waitsOn(c, board.me);

  return (
    <div className="anim-pop">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <rect x="3" y="4" width="5" height="16" rx="1.5" />
            <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
            <rect x="16" y="4" width="5" height="7" rx="1.5" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif-display text-3xl leading-none">Content Pipeline</h1>
          <p className="mt-1 text-sm text-ink-soft">One card per piece of content, from idea to published.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          + New card
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-line/60 p-0.5">
          {(["board", "table", "calendar", "review"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1 text-[13px] capitalize transition-colors ${
                view === v ? "bg-accent-soft font-medium text-accent" : "text-ink-soft hover:bg-parchment-dark/60"
              }`}
            >
              {v}
              {v === "review" && waitingOnMe > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-px text-[10px] font-bold text-white">
                  {waitingOnMe}
                </span>
              )}
            </button>
          ))}
        </div>
        {view !== "review" && (
        <>
        <select
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          className={`${inputCls} !w-auto !py-1.5 text-[13px]`}
          aria-label="Filter by person"
        >
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p === board?.me ? `${p} (me)` : p}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill on={!format} onClick={() => setFormat(null)}>All</Pill>
          {(board?.formats ?? []).map((f) => (
            <Pill key={f} on={format === f} onClick={() => setFormat(format === f ? null : f)}>
              {f}
            </Pill>
          ))}
        </div>
        </>
        )}
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      {!board ? (
        <p className="p-10 text-center text-sm text-ink-faint">Loading…</p>
      ) : (
        <>
          {/* ---------- board ---------- */}
          {view === "board" && (
            <div className="flex gap-3 overflow-x-auto pb-3">
              {board.stages.map((stage) => {
                const cards = onBoard.filter((c) => c.stage === stage).sort(byDue);
                return (
                  <section
                    key={stage}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverStage(stage);
                    }}
                    onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOverStage(null);
                      if (dragId) move(dragId, stage);
                      setDragId(null);
                    }}
                    className={`glass-panel flex min-h-[340px] w-[250px] shrink-0 flex-col rounded-2xl border p-2.5 transition-colors xl:w-auto xl:flex-1 ${
                      overStage === stage && dragId ? "border-accent bg-accent-soft/40" : "border-line/50"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                      {stage}
                      <span className="text-ink-faint">{cards.length}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {cards.map((c) => {
                        const p = projectOf(c);
                        return (
                          <button
                            key={c.id}
                            draggable
                            onDragStart={(e) => {
                              setDragId(c.id);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", c.id); // Firefox needs data to start a drag
                            }}
                            onDragEnd={() => {
                              setDragId(null);
                              setOverStage(null);
                            }}
                            onClick={() => setOpenId(c.id)}
                            className={`cursor-grab rounded-xl border bg-card/80 p-2.5 text-left transition-shadow hover:shadow-md active:cursor-grabbing ${
                              needsMe(c) ? "border-amber-500/70 shadow-[inset_3px_0_0_rgb(245_158_11)]" : "border-line/60"
                            } ${dragId === c.id ? "opacity-40" : ""}`}
                          >
                            <span className="block text-[13px] font-semibold leading-snug">{c.title}</span>
                            <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
                              {p ? (
                                <>
                                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                                  <span className="truncate">{p.name}</span>
                                  {p.nda === "no" && <span className="text-red-600 dark:text-red-300">· restricted</span>}
                                </>
                              ) : (
                                "general content"
                              )}
                            </span>
                            {needsResults(c) && (
                              <span className="mt-1.5 block text-[11px] text-ink-faint">+ add results and lesson</span>
                            )}
                            {needsMe(c) && (
                              <span className="mt-1.5 block text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                                Waiting for your approval
                              </span>
                            )}
                            {c.stage === "Review" && c.reviewers.length > 1 && (
                              <span className="mt-1.5 block text-[11px] text-ink-faint">
                                {c.approvals.length} of {c.reviewers.length} approved
                              </span>
                            )}
                            <span className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className={`${chip} ${FORMAT_CLS[c.format] ?? "border-line/60 text-ink-soft"}`}>
                                {c.format}
                              </span>
                              {c.due && <DueText c={c} />}
                              {c.comments.some((m) => !m.sys) && (
                                <span className="text-[11px] text-ink-faint" title="Comments">
                                  💬 {c.comments.filter((m) => !m.sys).length}
                                </span>
                              )}
                              <span className="ml-auto">
                                <Avatar name={c.owner} />
                              </span>
                            </span>
                          </button>
                        );
                      })}
                      {cards.length === 0 && <p className="px-1 py-6 text-center text-[12px] text-ink-faint">—</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* ---------- table ---------- */}
          {view === "table" && (
            <div className="glass-panel overflow-x-auto rounded-2xl border border-line/50">
              <table className="w-full min-w-[900px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line/50 text-[11px] uppercase tracking-wider text-ink-faint">
                    {["#", "Title", "Format", "Stage", "Owner", "Approvers", "Channels", "Due", "Project"].map((h) => (
                      <th key={h} className="px-3 py-2.5 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...onBoard]
                    .sort((a, b) => board.stages.indexOf(a.stage) - board.stages.indexOf(b.stage) || byDue(a, b))
                    .map((c, i) => (
                      <tr
                        key={c.id}
                        onClick={() => setOpenId(c.id)}
                        className="cursor-pointer border-b border-line/30 last:border-0 hover:bg-accent-soft/40"
                      >
                        <td className="w-10 px-3 py-2.5 text-right text-ink-faint">{i + 1}</td>
                        <td className="px-3 py-2.5 font-semibold">{c.title}</td>
                        <td className="px-3 py-2.5">
                          <span className={`${chip} ${FORMAT_CLS[c.format] ?? "border-line/60 text-ink-soft"}`}>{c.format}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`${chip} border-line/60 text-ink-soft`}>{c.stage}</span>
                        </td>
                        <td className="px-3 py-2.5"><Who name={c.owner} /></td>
                        <td className="px-3 py-2.5">
                          {c.reviewers.length ? (
                            <span className="flex gap-0.5">
                              {c.reviewers.map((r) => (
                                <Avatar key={r} name={r} />
                              ))}
                            </span>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 text-ink-soft">{c.channels.join(", ") || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{c.due ? <DueText c={c} /> : <span className="text-ink-faint">—</span>}</td>
                        <td className="max-w-[200px] truncate px-3 py-2.5 text-ink-faint">{projectOf(c)?.name ?? "—"}</td>
                      </tr>
                    ))}
                  {onBoard.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-ink-faint">No cards match.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ---------- calendar ---------- */}
          {view === "calendar" && <Calendar cards={onBoard} onOpen={setOpenId} />}

          {/* ---------- review queue (ignores the filters: it is about people) ---------- */}
          {view === "review" && (
            <ReviewQueue board={board} send={send} okToGoPublic={okToGoPublic} onOpen={setOpenId} />
          )}

          {/* ---------- content bank ---------- */}
          {view !== "review" && (
            <BankGrid
              board={board}
              cards={bank}
              filtered={!!format || !!person}
              send={send}
              reload={load}
              onOpen={setOpenId}
              onError={setError}
            />
          )}
        </>
      )}

      <p className="mt-3 text-[11px] text-ink-faint">
        Nothing is posted by this tool. A piece about a Restricted project cannot be moved to
        Scheduled or Published.
      </p>

      {openCard && board && (
        <CardPanel
          key={openCard.id}
          card={openCard}
          board={board}
          people={people}
          send={send}
          okToGoPublic={okToGoPublic}
          onRunChecker={onRunChecker}
          reload={load}
          error={error}
          onClose={() => setOpenId(null)}
          onDeleted={() => {
            setOpenId(null);
            load();
          }}
        />
      )}
      {creating && board && (
        <NewCardDialog
          board={board}
          people={people}
          onClose={() => {
            setCreating(false);
            load(); // a failed multi-create may have made some cards
          }}
          onCreated={(id) => {
            setCreating(false);
            load().then(() => setOpenId(id));
          }}
        />
      )}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
        on
          ? "border-accent bg-accent-soft font-medium text-accent"
          : "border-line/60 text-ink-soft hover:bg-parchment-dark/60"
      }`}
    >
      {children}
    </button>
  );
}

function DueText({ c }: { c: Card }) {
  const over = isOverdue(c);
  return (
    <span className={`text-[11px] ${over ? "font-semibold text-red-600 dark:text-red-300" : "text-ink-faint"}`}>
      {over ? "overdue " : "due "}
      {fmtDue(c.due as string)}
    </span>
  );
}

function Who({ name }: { name: string }) {
  if (!name) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Avatar name={name} />
      {name.split(" ")[0]}
    </span>
  );
}

/* ---------------- calendar (by due date) ---------------- */

function Calendar({ cards, onOpen }: { cards: Card[]; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const iso = (d: Date) => d.toLocaleDateString("en-CA");
  const todayIso = iso(new Date());

  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7)); // back to Monday
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const byDay = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of cards) if (c.due) m.set(c.due, [...(m.get(c.due) ?? []), c]);
    return m;
  }, [cards]);
  const undated = cards.filter((c) => !c.due).length;
  const step = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  const nav = "rounded-lg border border-line/60 px-2.5 py-1 text-sm text-ink-soft hover:bg-parchment-dark/60";

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => step(-1)} className={nav} aria-label="Previous month">‹</button>
        <span className="min-w-[140px] text-center text-[14px] font-semibold">
          {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => step(1)} className={nav} aria-label="Next month">›</button>
        <button onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className={nav}>
          Today
        </button>
        {undated > 0 && (
          <span className="ml-auto text-xs text-ink-faint">
            {undated} {undated === 1 ? "card has" : "cards have"} no due date — see Board or Table
          </span>
        )}
      </div>
      <div className="glass-panel overflow-hidden rounded-2xl border border-line/50">
        <div className="grid grid-cols-7 border-b border-line/50">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-ink-faint">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const key = iso(d);
            const out = d.getMonth() !== month.getMonth();
            return (
              <div
                key={key}
                className={`min-h-[104px] border-line/30 p-1.5 ${i % 7 !== 6 ? "border-r" : ""} ${i < 35 ? "border-b" : ""} ${
                  out ? "bg-parchment-dark/30" : ""
                }`}
              >
                <div
                  className={`mb-1 text-[11px] ${
                    key === todayIso ? "font-bold text-accent" : out ? "text-ink-faint/60" : "text-ink-faint"
                  }`}
                >
                  {d.getDate()}
                </div>
                {(byDay.get(key) ?? []).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onOpen(c.id)}
                    title={`${c.title} · ${c.stage}`}
                    className={`mb-1 block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px] ${
                      isOverdue(c)
                        ? "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300"
                        : FORMAT_CLS[c.format] ?? "border-line/60 text-ink-soft"
                    } ${c.stage === "Published" ? "opacity-60" : ""}`}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- new card ---------------- */

function NewCardDialog({
  board,
  people,
  onClose,
  onCreated,
}: {
  board: Board;
  people: string[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  // Several formats can be ticked: one card is made per format.
  const [formats, setFormats] = useState<string[]>([board.formats[0]]);
  const [projectId, setProjectId] = useState("");
  const [owner, setOwner] = useState(board.me);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = title.trim().length >= 2 && formats.length > 0;

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    let firstId = "";
    try {
      // In the order the formats are listed, not the order they were ticked.
      for (const format of board.formats.filter((f) => formats.includes(f))) {
        const res = await fetch("/api/marketing/pipeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: formats.length > 1 ? `${title.trim()} — ${format}` : title,
            format,
            projectId,
            owner,
            stage: "Angle",
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? "Could not create the card");
        firstId ||= d.card.id;
      }
      onCreated(firstId);
    } catch (e) {
      // Some cards may already exist — say so, and let the list show them.
      setError(
        (e instanceof Error ? e.message : "Could not create the card") +
          (firstId ? " Some cards were created; close this window to see them." : "")
      );
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-ice anim-pop-center w-full max-w-md rounded-2xl p-6">
        <h2 className="font-serif-display text-2xl">New card</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Starts in Angle. The brief, draft and assets are added on the card itself.
        </p>
        <div className="mt-4 flex flex-col gap-2.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Title — the angle, in one line"
            className={inputCls}
          />
          <div>
            <p className="mb-1.5 text-xs text-ink-soft">
              Format{formats.length > 1 ? " — one card is made per format" : " — tick more than one to make several cards"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {board.formats.map((f) => (
                <Pill
                  key={f}
                  on={formats.includes(f)}
                  onClick={() => setFormats((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))}
                >
                  {f}
                </Pill>
              ))}
            </div>
          </div>
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls} aria-label="Owner">
            <option value="">Unassigned</option>
            {people.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls} aria-label="Project">
            <option value="">No project — general content</option>
            {board.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.nda === "no" ? " (restricted)" : p.nda === "ask" ? " (NDA not checked)" : ""}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft hover:bg-parchment-dark/60">
            {error ? "Close" : "Cancel"}
          </button>
          <button
            onClick={submit}
            disabled={busy || !ready}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Creating…" : formats.length > 1 ? `Create ${formats.length} cards` : "Create card"}
          </button>
        </div>
      </div>
    </div>
  );
}
