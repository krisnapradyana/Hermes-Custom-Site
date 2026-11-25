"use client";

import { useRef, useState } from "react";
import { BANK, type Board, type Card, inputCls } from "./pipeline-shared";

/**
 * Content bank as a grid — ideas are typed straight in, spreadsheet style:
 * the last row creates an idea on Enter (pasting several lines creates
 * several), and every cell is edited in place. No form. Each row is still a
 * card underneath, so "Pick up" moves it to the board with nothing retyped.
 */

type Send = (id: string, body: Record<string, unknown>, optimistic?: Partial<Card>) => Promise<boolean>;

const cell = "border-b border-line/30 px-2 py-1.5 align-middle";
const bare =
  "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] outline-none hover:border-line/60 focus:border-accent focus:bg-card/70";

export function BankGrid({
  board,
  cards,
  filtered,
  send,
  reload,
  onOpen,
  onError,
}: {
  board: Board;
  cards: Card[];
  filtered: boolean;
  send: Send;
  reload: () => Promise<void> | void;
  onOpen: (id: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  // Channel picker: one floating checklist, anchored to the clicked cell.
  // Fixed-positioned because the grid scrolls sideways and would clip it.
  const [picker, setPicker] = useState<{ id: string; top: number; left: number } | null>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const addIdeas = async (titles: string[]) => {
    const list = titles.map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 50);
    if (!list.length || adding) return;
    setAdding(true);
    onError(null);
    try {
      for (const title of list) {
        const res = await fetch("/api/marketing/pipeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, stage: BANK, format: board.formats[0] }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not add the idea");
      }
      setDraft("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not add the idea");
    } finally {
      await reload();
      setAdding(false);
      requestAnimationFrame(() => newRef.current?.focus());
    }
  };

  const remove = async (c: Card) => {
    if (!confirm(`Delete the idea "${c.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/marketing/pipeline?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
    if (!res.ok) onError("Could not delete the idea");
    reload();
  };

  const picked = picker ? cards.find((c) => c.id === picker.id) : null;

  return (
    <section className="mt-7">
      <div className="mb-2">
        <h2 className="text-[15px] font-semibold">
          Content bank{" "}
          <span className="font-normal text-ink-faint">
            · {cards.length} {cards.length === 1 ? "idea" : "ideas"}
          </span>
        </h2>
        <p className="text-[12.5px] text-ink-soft">
          Rough ideas, not scheduled yet. Type in the last row and press Enter — or paste a list, one idea per line.
        </p>
      </div>

      <div className="glass-panel overflow-x-auto rounded-2xl border border-line/50">
        <table className="w-full min-w-[860px] table-fixed text-left text-[13px]">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-[150px]" />
            <col className="w-[170px]" />
            <col className="w-[190px]" />
            <col className="w-[150px]" />
          </colgroup>
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-ink-faint">
              {["#", "Idea", "Format", "Channels", "Project", ""].map((h, i) => (
                <th key={i} className="border-b border-line/50 px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cards.map((c, i) => (
              <tr key={c.id} className="group hover:bg-accent-soft/20">
                <td className={`${cell} text-right text-ink-faint`}>{i + 1}</td>
                <td className={cell}>
                  <TitleCell card={c} send={send} />
                </td>
                <td className={cell}>
                  <select
                    value={c.format}
                    onChange={(e) => send(c.id, { format: e.target.value }, { format: e.target.value })}
                    className={bare}
                    aria-label="Format"
                  >
                    {board.formats.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </td>
                <td className={cell}>
                  <button
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setPicker({ id: c.id, top: r.bottom + 4, left: r.left });
                    }}
                    className={`${bare} truncate text-left ${c.channels.length ? "" : "text-ink-faint"}`}
                    title="Choose channels"
                  >
                    {c.channels.join(", ") || "—"}
                  </button>
                </td>
                <td className={cell}>
                  <select
                    value={c.projectId ?? ""}
                    onChange={(e) =>
                      send(c.id, { projectId: e.target.value }, { projectId: e.target.value || undefined })
                    }
                    className={`${bare} ${c.projectId ? "" : "text-ink-faint"}`}
                    aria-label="Project"
                  >
                    <option value="">—</option>
                    {board.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`${cell} whitespace-nowrap text-right`}>
                  <button
                    onClick={() => onOpen(c.id)}
                    title="Open the full card"
                    className="rounded-md px-1.5 py-1 text-xs text-ink-faint hover:text-accent"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => send(c.id, { stage: "Angle", owner: c.owner || board.me }, { stage: "Angle" })}
                    className="rounded-lg border border-line/60 px-2 py-1 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent"
                  >
                    Pick up →
                  </button>
                  <button
                    onClick={() => remove(c)}
                    aria-label={`Delete ${c.title}`}
                    title="Delete idea"
                    className="ml-1 rounded-md px-1 text-ink-faint opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-3 py-1.5 text-right text-ink-faint">+</td>
              <td colSpan={5} className="px-2 py-1.5">
                <input
                  ref={newRef}
                  value={draft}
                  disabled={adding}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addIdeas([draft])}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text");
                    if (!/\r?\n/.test(text.trim())) return; // single line: a normal paste
                    e.preventDefault();
                    addIdeas(text.split(/\r?\n/));
                  }}
                  placeholder={adding ? "Adding…" : "Type an idea and press Enter"}
                  aria-label="New idea"
                  className={`${inputCls} !border-transparent !bg-transparent text-[13px] focus:!border-accent`}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {filtered && (
        <p className="mt-1.5 text-[11px] text-ink-faint">
          A filter is on — new ideas may be hidden until you clear it.
        </p>
      )}

      {picker && picked && (
        <div className="fixed inset-0 z-40" onMouseDown={(e) => e.target === e.currentTarget && setPicker(null)}>
          <div
            className="glass-ice absolute w-[190px] rounded-xl border border-line/60 p-2 shadow-lg"
            style={{ top: Math.min(picker.top, window.innerHeight - 300), left: Math.min(picker.left, window.innerWidth - 200) }}
          >
            {board.channels.map((ch) => {
              const on = picked.channels.includes(ch);
              return (
                <label key={ch} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-parchment-dark/50">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const channels = on ? picked.channels.filter((x) => x !== ch) : [...picked.channels, ch];
                      send(picked.id, { channels }, { channels });
                    }}
                    className="accent-[var(--color-accent)]"
                  />
                  {ch}
                </label>
              );
            })}
            <button onClick={() => setPicker(null)} className="mt-1 w-full rounded-md py-1 text-xs text-ink-soft hover:bg-parchment-dark/50">
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The idea text: a plain input that saves when you leave it or press Enter. */
function TitleCell({ card, send }: { card: Card; send: Send }) {
  const [value, setValue] = useState(card.title);
  const save = () => {
    const v = value.trim();
    if (v === card.title) return;
    if (v.length < 2) return setValue(card.title);
    send(card.id, { title: v }, { title: v });
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setValue(card.title);
      }}
      aria-label="Idea"
      className={`${bare} font-semibold`}
    />
  );
}
