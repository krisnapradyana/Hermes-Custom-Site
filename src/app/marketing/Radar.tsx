"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectPage } from "./ProjectPage";
import {
  type Item,
  type Status,
  STATUS,
  ChannelTicks,
  Head,
  NdaSwitch,
  chip,
  fmtDate,
  inputCls,
  statusOf,
} from "./radar-shared";

/**
 * Publish Radar — which delivered projects are safe and ready to talk about.
 * Rows come live from the tracker (projects marked done) plus hand-added
 * ones. Everything on the right is marketing's manual record (v1): where the
 * client has published, NDA status, the angle, and what content is planned.
 * Nothing is posted from here.
 */

const FILTERS: { id: "all" | Status | "hidden"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready to plan" },
  { id: "planned", label: "Planned" },
  { id: "waiting", label: "Wait for client" },
  { id: "ask", label: "Ask producer" },
  { id: "restricted", label: "Restricted" },
  { id: "hidden", label: "Not for marketing" },
];

export function Radar({ onOpenCard }: { onOpenCard: (id: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [standard, setStandard] = useState<string[]>([]);
  const [pageId, setPageId] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/radar");
      if (!res.ok) throw new Error();
      const d = await res.json();
      setItems(d.items);
      setChannels(d.channels);
      setFormats(d.formats);
      setStandard(d.standard ?? []);
    } catch {
      setError("Could not load the radar — reload the page");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  /** Optimistic update; the server's copy replaces it, a failure reloads. */
  const patch = useCallback(
    async (id: string, change: Partial<Item>) => {
      setItems((list) => list?.map((it) => (it.id === id ? { ...it, ...change } : it)) ?? list);
      try {
        const res = await fetch("/api/marketing/radar", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, ...change }),
        });
        if (!res.ok) throw new Error();
        const { entry } = await res.json();
        setItems((list) => list?.map((it) => (it.id === id ? { ...it, ...entry } : it)) ?? list);
        setError(null);
      } catch {
        setError("Change was not saved — check your connection");
        load();
      }
    },
    [load]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, hidden: 0 };
    for (const it of items ?? []) {
      if (it.excluded) {
        c.hidden++;
        continue;
      }
      c.all++;
      const s = statusOf(it, channels);
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [items, channels]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((it) => {
      if (filter === "hidden" ? !it.excluded : it.excluded) return false;
      if (filter !== "all" && filter !== "hidden" && statusOf(it, channels) !== filter) return false;
      return !q || it.name.toLowerCase().includes(q) || it.sub.toLowerCase().includes(q);
    });
  }, [items, channels, filter, query]);

  const selected = shown.find((it) => it.id === sel) ?? shown[0] ?? null;

  const pageItem = pageId ? items?.find((it) => it.id === pageId) : null;
  if (pageItem) {
    return (
      <ProjectPage
        key={pageItem.id}
        it={pageItem}
        channels={channels}
        standard={standard}
        patch={patch}
        reload={load}
        error={error}
        onBack={() => setPageId(null)}
        onOpenCard={onOpenCard}
      />
    );
  }

  return (
    <div className="anim-pop">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 12l6.5-6.5" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif-display text-3xl leading-none">Publish Radar</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Delivered projects, and whether each one is safe and ready to talk about.
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="rounded-xl border border-line/60 px-4 py-2 text-sm text-ink-soft transition-colors hover:bg-parchment-dark/60"
        >
          + Add project
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search project…"
          className={`${inputCls} mr-1 max-w-[220px] !py-1.5`}
        />
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
              filter === f.id
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "border-line/60 text-ink-soft hover:bg-parchment-dark/60"
            }`}
          >
            {f.label}
            <span className="ml-1.5 text-ink-faint">{counts[f.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* ---- list ---- */}
        <section className="glass-panel rounded-2xl border border-line/50 p-2">
          {items === null ? (
            <p className="p-8 text-center text-sm text-ink-faint">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-faint">
              {items.length === 0
                ? "No delivered projects yet. Projects appear here when they are marked done in the tracker — or add one by hand."
                : "Nothing matches this filter."}
            </p>
          ) : (
            shown.map((it) => {
              const st = statusOf(it, channels);
              const active = selected?.id === it.id;
              return (
                // Two click targets: the name opens the project page straight
                // away; the rest of the row only selects it for the side pane.
                <div
                  key={it.id}
                  className={`flex w-full items-stretch rounded-xl border transition-colors ${
                    active ? "border-accent/60 bg-accent-soft/60" : "border-transparent hover:bg-parchment-dark/50"
                  } ${st === "restricted" || it.excluded ? "opacity-60" : ""}`}
                >
                  <button
                    onClick={() => {
                      setSel(it.id);
                      setPageId(it.id);
                    }}
                    title="Open project page"
                    className="group flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-2 text-left"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: it.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold group-hover:text-accent group-hover:underline">
                        {it.name}
                      </span>
                      <span className="block truncate text-[12px] text-ink-faint">
                        delivered {fmtDate(it.deliveredAt)}
                        {it.sub ? ` · ${it.sub}` : ""}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => setSel(it.id)}
                    title="Show quick details"
                    className="flex shrink-0 items-center gap-3 py-2.5 pl-2 pr-3"
                  >
                    <span className="hidden shrink-0 gap-0.5 sm:flex">
                      {channels.map((c) => (
                        <span
                          key={c}
                          title={`${c}: ${it.pub[c] ? "published" : "not yet"}`}
                          className={`flex h-[18px] w-[18px] items-center justify-center rounded text-[9px] font-bold ${
                            it.pub[c]
                              ? "border border-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                              : "border border-line/60 text-ink-faint"
                          }`}
                        >
                          {c[0]}
                        </span>
                      ))}
                    </span>
                    <span className="flex w-[112px] shrink-0 justify-end">
                      <span className={`${chip} ${STATUS[st].cls}`}>{STATUS[st].label}</span>
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </section>

        {/* ---- detail ---- */}
        {selected ? (
          <Detail key={selected.id} it={selected} channels={channels} formats={formats} patch={patch} reload={load} onOpenPage={() => setPageId(selected.id)} />
        ) : (
          <section className="glass-panel hidden rounded-2xl border border-line/50 p-8 text-center text-sm text-ink-faint lg:block">
            Select a project.
          </section>
        )}
      </div>

      <p className="mt-3 text-[11px] text-ink-faint">
        Client-published ticks are entered by hand for now. Nothing is posted by this tool — it only
        records what is safe and ready.
      </p>

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            setFilter("all");
            setSel(id);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- detail pane ---------------- */

function Detail({
  it,
  channels,
  formats,
  patch,
  reload,
  onOpenPage,
}: {
  it: Item;
  channels: string[];
  formats: string[];
  patch: (id: string, change: Partial<Item>) => void;
  reload: () => void;
  onOpenPage: () => void;
}) {
  // Text fields save on blur — local copies while typing.
  const [ndaNote, setNdaNote] = useState(it.ndaNote);
  const [angle, setAngle] = useState(it.angle);
  const st = statusOf(it, channels);
  const anyPub = channels.some((c) => it.pub[c]);

  const remove = async () => {
    if (!confirm(`Remove "${it.name}" from the radar? This cannot be undone.`)) return;
    await fetch(`/api/marketing/radar?id=${encodeURIComponent(it.id)}`, { method: "DELETE" });
    reload();
  };

  // One pipeline card per planned format that doesn't have one yet.
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const missing = it.formats.filter((f) => !it.cards.some((c) => c.format === f));
  const addToPipeline = async () => {
    if (sending || !missing.length) return;
    setSending(true);
    setSendError(null);
    try {
      for (const format of missing) {
        const res = await fetch("/api/marketing/pipeline", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: `${it.name} — ${format}`,
            format,
            projectId: it.id,
            notes: it.angle ? `Angle: ${it.angle}` : "",
          }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not add");
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not add");
    } finally {
      setSending(false);
      reload();
    }
  };

  return (
    <section className="glass-panel rounded-2xl border border-line/50 p-5 lg:sticky lg:top-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: it.color }} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold leading-snug">{it.name}</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            delivered {fmtDate(it.deliveredAt)} · {it.source === "tracker" ? "from tracker" : "added by hand"}
          </p>
        </div>
        <span className={`${chip} ${STATUS[st].cls}`}>{STATUS[st].label}</span>
      </div>
      {it.sub && <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{it.sub}</p>}
      <button
        onClick={onOpenPage}
        className="mt-3 w-full rounded-xl border border-line/60 px-3 py-2 text-[13px] font-medium text-accent transition-colors hover:border-accent hover:bg-accent-soft/50"
      >
        Open project page →
      </button>

      <Head>Client has published on</Head>
      <ChannelTicks channels={channels} pub={it.pub} onChange={(pub) => patch(it.id, { pub })} />
      {!anyPub && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-300">
          Nothing ticked yet — do not post before the client does.
        </p>
      )}

      <Head>NDA / posting rights</Head>
      <NdaSwitch value={it.nda} onChange={(nda) => patch(it.id, { nda })} />
      <textarea
        value={ndaNote}
        onChange={(e) => setNdaNote(e.target.value)}
        onBlur={() => ndaNote.trim() !== it.ndaNote && patch(it.id, { ndaNote })}
        placeholder="Who confirmed it, and any condition — e.g. cleared by the producer, client posted first"
        rows={2}
        className={`${inputCls} mt-2 resize-y`}
      />

      <Head>Angle</Head>
      <textarea
        value={angle}
        onChange={(e) => setAngle(e.target.value)}
        onBlur={() => angle.trim() !== it.angle && patch(it.id, { angle })}
        placeholder="The one idea worth telling — a scene or a lesson, not a description of the project"
        rows={2}
        className={`${inputCls} resize-y`}
      />

      <Head>Planned content</Head>
      <div className="flex flex-wrap gap-1.5">
        {formats.map((f) => {
          const on = it.formats.includes(f);
          return (
            <button
              key={f}
              onClick={() =>
                patch(it.id, { formats: on ? it.formats.filter((x) => x !== f) : [...it.formats, f] })
              }
              className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                on
                  ? "border-accent bg-accent-soft font-medium text-accent"
                  : "border-line/60 text-ink-soft hover:bg-parchment-dark/50"
              }`}
            >
              {f}
            </button>
          );
        })}
      </div>

      <Head>In the pipeline</Head>
      {it.cards.length > 0 && (
        <ul className="mb-2 flex flex-col gap-1">
          {it.cards.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className={`${chip} border-line/60 text-ink-soft`}>{c.stage}</span>
            </li>
          ))}
        </ul>
      )}
      {it.nda !== "ok" ? (
        <p className="text-xs text-ink-faint">Clear the NDA status first — then planned content can become pipeline cards.</p>
      ) : missing.length ? (
        <button
          onClick={addToPipeline}
          disabled={sending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {sending ? "Adding…" : `+ Add to pipeline (${missing.join(", ")})`}
        </button>
      ) : (
        <p className="text-xs text-ink-faint">
          {it.cards.length
            ? "Every planned format has a card. Pick another format above to add more."
            : "Pick a planned content format above to create its card."}
        </p>
      )}
      {sendError && <p className="mt-1.5 text-xs text-red-600 dark:text-red-300">{sendError}</p>}

      <div className="mt-5 flex items-center gap-3 border-t border-line/50 pt-3">
        <button
          onClick={() => patch(it.id, { excluded: !it.excluded })}
          className="rounded-lg border border-line/60 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:bg-parchment-dark/60"
        >
          {it.excluded ? "Put back on the radar" : "Mark “not for marketing”"}
        </button>
        {it.source === "manual" && (
          <button onClick={remove} className="text-xs text-red-600 underline dark:text-red-300">
            Remove
          </button>
        )}
        {it.updatedBy && (
          <span className="ml-auto truncate text-[11px] text-ink-faint">
            {it.updatedBy}
            {it.updatedAt
              ? ` · ${new Date(it.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
              : ""}
          </span>
        )}
      </div>
    </section>
  );
}

/* ---------------- add dialog ---------------- */

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [deliveredAt, setDeliveredAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || name.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/radar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, client, deliveredAt }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not add the project");
      onAdded(d.project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the project");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-ice anim-pop-center w-full max-w-md rounded-2xl p-6">
        <h2 className="font-serif-display text-2xl">Add a project</h2>
        <p className="mt-1 text-sm text-ink-soft">
          For delivered work the tracker doesn&apos;t list. Projects marked done in the tracker
          appear on their own.
        </p>
        <div className="mt-4 flex flex-col gap-2.5">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" className={inputCls} />
          <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client (optional)" className={inputCls} />
          <label className="text-xs text-ink-soft">
            Delivered on (optional)
            <input type="date" value={deliveredAt} onChange={(e) => setDeliveredAt(e.target.value)} className={`${inputCls} mt-1`} />
          </label>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft hover:bg-parchment-dark/60">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || name.trim().length < 2}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add project"}
          </button>
        </div>
      </div>
    </div>
  );
}
