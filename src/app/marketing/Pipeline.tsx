"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Content Pipeline — a board of content pieces (one card per angle) moving
 * Angle → Drafting → Review → Scheduled → Published. Drag a card between
 * columns, or open it to edit. Cards linked to a radar project carry that
 * project's posting rules: Restricted blocks the last two stages (server
 * enforced); "not cleared" / "client hasn't published" ask for confirmation.
 */

interface Card {
  id: string;
  title: string;
  format: string;
  stage: string;
  projectId?: string;
  owner: string;
  due?: string;
  draftUrl: string;
  publishedUrl: string;
  notes: string;
  updatedBy: string;
  updatedAt: string;
}
interface ProjectRef {
  id: string;
  name: string;
  color: string;
  nda: "ask" | "ok" | "no";
  clientPublished: boolean;
}
interface Board {
  cards: Card[];
  projects: ProjectRef[];
  people: string[];
  stages: string[];
  formats: string[];
  me: string;
}

const PUBLIC_STAGES = ["Scheduled", "Published"];

const FORMAT_CLS: Record<string, string> = {
  "Landing page": "border-sky-500/50 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "SEO article": "border-violet-500/50 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  EDM: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "Social carousel": "border-pink-500/50 bg-pink-500/15 text-pink-700 dark:text-pink-300",
  "Case study": "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Portfolio: "border-teal-500/50 bg-teal-500/15 text-teal-700 dark:text-teal-300",
};

const chip = "rounded-full border px-2 py-0.5 text-[10.5px] font-medium whitespace-nowrap";
const inputCls =
  "w-full rounded-xl border border-line/60 bg-card/70 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent";

const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
const fmtDue = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function Pipeline() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [editing, setEditing] = useState<Card | "new" | null>(null);
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

  const move = useCallback(
    async (id: string, stage: string) => {
      const card = board?.cards.find((c) => c.id === id);
      if (!card || card.stage === stage || !okToGoPublic(card, stage)) return;
      setBoard((b) => b && { ...b, cards: b.cards.map((c) => (c.id === id ? { ...c, stage } : c)) });
      try {
        const res = await fetch("/api/marketing/pipeline", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, stage }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Move was not saved");
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Move was not saved");
        load();
      }
    },
    [board, okToGoPublic, load]
  );

  const visible = useMemo(
    () =>
      (board?.cards ?? []).filter(
        (c) => (!format || c.format === format) && (!mine || c.owner === board?.me)
      ),
    [board, format, mine]
  );

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
          <p className="mt-1 text-sm text-ink-soft">One card per angle, from idea to published. Drag to move.</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          + New card
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Pill on={!format} onClick={() => setFormat(null)}>All</Pill>
        {(board?.formats ?? []).map((f) => (
          <Pill key={f} on={format === f} onClick={() => setFormat(format === f ? null : f)}>
            {f}
          </Pill>
        ))}
        <span className="mx-1 h-4 w-px bg-line/60" />
        <Pill on={mine} onClick={() => setMine(!mine)}>Mine</Pill>
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      {!board ? (
        <p className="p-10 text-center text-sm text-ink-faint">Loading…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {board.stages.map((stage) => {
            const cards = visible
              .filter((c) => c.stage === stage)
              .sort(
                (a, b) =>
                  (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.updatedAt.localeCompare(a.updatedAt)
              );
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
                className={`glass-panel flex min-h-[420px] w-[250px] shrink-0 flex-col rounded-2xl border p-2.5 transition-colors xl:w-auto xl:flex-1 ${
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
                    const overdue = !!c.due && c.due < today() && c.stage !== "Published";
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
                        onClick={() => setEditing(c)}
                        className={`cursor-grab rounded-xl border border-line/60 bg-card/80 p-2.5 text-left transition-shadow hover:shadow-md active:cursor-grabbing ${
                          dragId === c.id ? "opacity-40" : ""
                        }`}
                      >
                        <span className="block text-[13px] font-semibold leading-snug">{c.title}</span>
                        {p && (
                          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-faint">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                            <span className="truncate">{p.name}</span>
                            {p.nda === "no" && <span className="text-red-600 dark:text-red-300">· restricted</span>}
                          </span>
                        )}
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={`${chip} ${FORMAT_CLS[c.format] ?? "border-line/60 text-ink-soft"}`}>
                            {c.format}
                          </span>
                          {c.due && (
                            <span
                              className={`text-[11px] ${
                                overdue ? "font-semibold text-red-600 dark:text-red-300" : "text-ink-faint"
                              }`}
                            >
                              {overdue ? "overdue " : "due "}
                              {fmtDue(c.due)}
                            </span>
                          )}
                          <span className="ml-auto truncate text-[11px] text-ink-soft">
                            {c.owner ? c.owner.split(" ")[0] : "unassigned"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {cards.length === 0 && (
                    <p className="px-1 py-6 text-center text-[12px] text-ink-faint">—</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-1 text-[11px] text-ink-faint">
        Nothing is posted by this tool. A piece about a Restricted project cannot be moved to
        Scheduled or Published.
      </p>

      {editing && board && (
        <CardDialog
          card={editing === "new" ? null : editing}
          board={board}
          okToGoPublic={okToGoPublic}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
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

/* ---------------- card dialog (new + edit) ---------------- */

function CardDialog({
  card,
  board,
  okToGoPublic,
  onClose,
  onSaved,
}: {
  card: Card | null;
  board: Board;
  okToGoPublic: (c: { projectId?: string }, stage: string) => boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    title: card?.title ?? "",
    format: card?.format ?? board.formats[0],
    stage: card?.stage ?? board.stages[0],
    projectId: card?.projectId ?? "",
    owner: card?.owner ?? board.me,
    due: card?.due ?? "",
    draftUrl: card?.draftUrl ?? "",
    publishedUrl: card?.publishedUrl ?? "",
    notes: card?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  // The owner list is the marketing team; keep an existing owner selectable
  // even if they've since left the list.
  const people = useMemo(
    () => Array.from(new Set([...board.people, board.me, f.owner].filter(Boolean))),
    [board.people, board.me, f.owner]
  );

  const badUrl = (u: string) => !!u.trim() && !/^https?:\/\//i.test(u.trim());

  const save = async () => {
    if (busy) return;
    if (f.title.trim().length < 2) return setError("Give the card a title");
    if (badUrl(f.draftUrl) || badUrl(f.publishedUrl)) return setError("Links must start with http:// or https://");
    const stageChanged = !card || card.stage !== f.stage || (card.projectId ?? "") !== f.projectId;
    if (stageChanged && !okToGoPublic({ projectId: f.projectId || undefined }, f.stage)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/pipeline", {
        method: card ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(card ? { id: card.id, ...f } : f),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!card || !confirm(`Delete "${card.title}"? This cannot be undone.`)) return;
    setBusy(true);
    await fetch(`/api/marketing/pipeline?id=${encodeURIComponent(card.id)}`, { method: "DELETE" });
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-ice anim-pop-center max-h-full w-full max-w-lg overflow-y-auto rounded-2xl p-6">
        <h2 className="font-serif-display text-2xl">{card ? "Edit card" : "New card"}</h2>

        <div className="mt-4 flex flex-col gap-3">
          <Field label="Title — the angle, in one line">
            <input autoFocus value={f.title} onChange={set("title")} placeholder="e.g. HHN14: two shows, two approaches" className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Format">
              <select value={f.format} onChange={set("format")} className={inputCls}>
                {board.formats.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Stage">
              <select value={f.stage} onChange={set("stage")} className={inputCls}>
                {board.stages.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Owner">
              <select value={f.owner} onChange={set("owner")} className={inputCls}>
                <option value="">Unassigned</option>
                {people.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Due date">
              <input type="date" value={f.due} onChange={set("due")} className={inputCls} />
            </Field>
          </div>
          <Field label="Project (from the Publish Radar)">
            <select value={f.projectId} onChange={set("projectId")} className={inputCls}>
              <option value="">None — general content</option>
              {board.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.nda === "no" ? " (restricted)" : p.nda === "ask" ? " (NDA not checked)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Draft link">
            <input value={f.draftUrl} onChange={set("draftUrl")} placeholder="https://docs.google.com/…" className={inputCls} />
          </Field>
          {(PUBLIC_STAGES.includes(f.stage) || f.publishedUrl) && (
            <Field label="Published link">
              <input value={f.publishedUrl} onChange={set("publishedUrl")} placeholder="https://…" className={inputCls} />
            </Field>
          )}
          <Field label="Notes">
            <textarea value={f.notes} onChange={set("notes")} rows={3} placeholder="Brief, reviewer comments, checker score…" className={`${inputCls} resize-y`} />
          </Field>
        </div>

        {(f.draftUrl || f.publishedUrl) && !badUrl(f.draftUrl) && !badUrl(f.publishedUrl) && (
          <p className="mt-3 flex gap-4 text-xs">
            {f.draftUrl && (
              <a href={f.draftUrl.trim()} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                Open draft
              </a>
            )}
            {f.publishedUrl && (
              <a href={f.publishedUrl.trim()} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                Open published piece
              </a>
            )}
          </p>
        )}

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}

        <div className="mt-5 flex items-center gap-2">
          {card && (
            <button onClick={remove} disabled={busy} className="text-xs text-red-600 underline dark:text-red-300">
              Delete card
            </button>
          )}
          {card && (
            <span className="ml-2 truncate text-[11px] text-ink-faint">
              last edit {card.updatedBy} ·{" "}
              {new Date(card.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          )}
          <button onClick={onClose} className="ml-auto rounded-xl px-4 py-2 text-sm text-ink-soft hover:bg-parchment-dark/60">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Saving…" : card ? "Save" : "Create card"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
