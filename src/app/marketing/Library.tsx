"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Library & Rules — the reference shelf: links to the approved documents,
 * the checker prompts exactly as they run (read-only, versioned), and the
 * house rules those prompts enforce, in readable form.
 */

interface Reference {
  id: string;
  title: string;
  url: string;
  note: string;
  addedBy?: string;
}
interface Prompt {
  id: string;
  label: string;
  version: string;
  text: string;
}
interface RuleBlock {
  title: string;
  kind: "chips" | "list";
  tone?: "bad" | "good";
  items: string[];
  source: string;
}
interface Data {
  references: Reference[];
  prompts: Prompt[];
  rules: RuleBlock[];
}

const inputCls =
  "w-full rounded-xl border border-line/60 bg-card/70 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent";
const card = "glass-panel rounded-2xl border border-line/50 p-5";
const head = "text-[11px] font-semibold uppercase tracking-wider text-ink-soft";

export function Library() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Prompt | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/library");
      if (!res.ok) throw new Error();
      setData(await res.json());
      setError(null);
    } catch {
      setError("Could not load the library — reload the page");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (r: Reference) => {
    if (!confirm(`Remove "${r.title}" from the library? The document itself is not touched.`)) return;
    const res = await fetch(`/api/marketing/library?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
    if (!res.ok) setError("Could not remove the reference");
    load();
  };

  return (
    <div className="anim-pop">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 4h4v16H5zM10.5 4h4v16h-4z" />
            <path d="M16 6.5l3.5-1 3 13.5-3.5 1z" />
          </svg>
        </span>
        <div>
          <h1 className="font-serif-display text-3xl leading-none">Library &amp; Rules</h1>
          <p className="mt-1 text-sm text-ink-soft">
            The approved references, the prompts the checker runs, and the rules they enforce.
          </p>
        </div>
      </div>

      {error && (
        <p className="mb-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      {!data ? (
        <p className="p-10 text-center text-sm text-ink-faint">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            {/* ---- references ---- */}
            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <span className={head}>Approved references</span>
                <button
                  onClick={() => setAdding(true)}
                  className="rounded-lg border border-line/60 px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-parchment-dark/60"
                >
                  + Add link
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {data.references.map((r) => (
                  <li key={r.id} className="group flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-parchment-dark/50">
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-accent">{r.title} ↗</span>
                      {r.note && <span className="block text-[12px] leading-snug text-ink-soft">{r.note}</span>}
                    </a>
                    <button
                      onClick={() => remove(r)}
                      title="Remove from library"
                      aria-label={`Remove ${r.title}`}
                      className="shrink-0 rounded-md px-1.5 text-ink-faint opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </li>
                ))}
                {data.references.length === 0 && (
                  <li className="px-2 py-4 text-center text-xs text-ink-faint">No references yet.</li>
                )}
              </ul>
              <p className="mt-3 text-[11px] text-ink-faint">
                Links open the live document — never a copy. You need access to the doc itself.
              </p>
            </section>

            {/* ---- prompts ---- */}
            <section className={card}>
              <div className={`${head} mb-3`}>Checker prompts</div>
              <ul className="flex flex-col gap-1">
                {data.prompts.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => setOpen(p)}
                      className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-parchment-dark/50"
                    >
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.label}</span>
                      <span className="rounded-full border border-line/60 px-2 py-0.5 text-[11px] text-ink-soft">
                        {p.version}
                      </span>
                      <span className="text-xs text-accent">View</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-ink-faint">
                This is the exact text Checker Studio runs. To change a prompt, send the new wording —
                it ships as a new version, and every review shows the version it used.
              </p>
            </section>
          </div>

          {/* ---- house rules ---- */}
          <section className={card}>
            <div className={`${head} mb-1`}>House rules the checker enforces</div>
            <div className="grid grid-cols-1 gap-x-8 xl:grid-cols-2">
              {data.rules.map((b) => (
                <div key={b.title} className="mt-4">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-[15px] font-semibold">{b.title}</h3>
                    <span className="text-[11px] text-ink-faint">{b.source}</span>
                  </div>
                  {b.kind === "chips" ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {b.items.map((x) => (
                        <span
                          key={x}
                          className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                            b.tone === "bad"
                              ? "border-red-500/40 bg-red-500/10 text-red-700 line-through decoration-red-500/50 dark:text-red-300"
                              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          }`}
                        >
                          {x}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1.5">
                      {b.items.map((x) => (
                        <li key={x} className="flex gap-2 text-[13px] leading-relaxed text-ink-soft">
                          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {open && <PromptDialog prompt={open} onClose={() => setOpen(null)} />}
      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function PromptDialog({ prompt, onClose }: { prompt: Prompt; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the text is selectable */
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-ice anim-pop-center flex max-h-full w-full max-w-3xl flex-col rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <h2 className="font-serif-display min-w-0 flex-1 truncate text-2xl">{prompt.label}</h2>
          <span className="rounded-full border border-line/60 px-2 py-0.5 text-[11px] text-ink-soft">
            {prompt.version}
          </span>
          <button
            onClick={copy}
            className="rounded-lg border border-line/60 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:bg-parchment-dark/60"
          >
            {copied ? "Copied" : "Copy prompt"}
          </button>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-ink-soft hover:bg-parchment-dark/60">
            ×
          </button>
        </div>
        <pre className="mt-4 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line/50 bg-card/60 p-4 font-mono text-[12.5px] leading-relaxed text-ink-soft">
          {prompt.text}
        </pre>
      </div>
    </div>
  );
}

function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, url, note }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not add the link");
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the link");
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-ice anim-pop-center w-full max-w-md rounded-2xl p-6">
        <h2 className="font-serif-display text-2xl">Add a reference</h2>
        <p className="mt-1 text-sm text-ink-soft">A link to an approved document the team should write from.</p>
        <div className="mt-4 flex flex-col gap-2.5">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className={inputCls} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/…" className={inputCls} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it is for (optional)" className={inputCls} />
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft hover:bg-parchment-dark/60">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || title.trim().length < 2 || !url.trim()}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add link"}
          </button>
        </div>
      </div>
    </div>
  );
}
