"use client";

import { useState } from "react";
import {
  type Item,
  type Patch,
  type RadarCard,
  STATUS,
  ChannelTicks,
  Head,
  NdaSwitch,
  chip,
  fmtDate,
  inputCls,
  statusOf,
} from "./radar-shared";
import { Avatar, FORMAT_CLS, fmtDue } from "./pipeline-shared";

/**
 * Project page — opened from a project on the Publish Radar. Left: the
 * master record (summary, challenge, contribution, services, restrictions,
 * source links), written once and reused for every piece. Right: the
 * deliverables — the standard set per project plus anything else that has a
 * card — showing what exists, what remains and who acts next.
 */

const LABEL: Record<string, string> = { "Social carousel": "Reel / carousel" };
const label = (f: string) => LABEL[f] ?? f;

const STAGE_CLS: Record<string, string> = {
  Published: "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  Scheduled: "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  Review: "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  Drafting: "border-accent/50 bg-accent-soft text-accent",
  Angle: "border-accent/50 bg-accent-soft text-accent",
};

const first = (n: string) => n.split(" ")[0];
/** Who has to act for the piece to move on. */
function nextStep(c: RadarCard): string {
  switch (c.stage) {
    case "Bank":
      return "Pick up from the content bank";
    case "Angle":
      return c.owner ? `${first(c.owner)} to start the draft` : "Needs an owner";
    case "Drafting":
      return c.owner ? `${first(c.owner)} to finish the draft` : "Needs an owner";
    case "Review":
      return c.reviewer ? `${first(c.reviewer)} to review` : "Needs a reviewer";
    case "Scheduled":
      return c.owner ? `${first(c.owner)} to publish` : "Ready to publish";
    default:
      return "Done";
  }
}

const isHttp = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const todayIso = () => new Date().toLocaleDateString("en-CA");

export function ProjectPage({
  it,
  channels,
  standard,
  patch,
  reload,
  error,
  onBack,
  onOpenCard,
}: {
  it: Item;
  channels: string[];
  standard: string[];
  patch: Patch;
  reload: () => void;
  error: string | null;
  onBack: () => void;
  onOpenCard: (id: string) => void;
}) {
  // Text fields save on blur — local copies while typing.
  const [text, setText] = useState({
    summary: it.summary,
    challenge: it.challenge,
    contribution: it.contribution,
    ndaNote: it.ndaNote,
  });
  const [service, setService] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const st = statusOf(it, channels);
  const saveText = (k: keyof typeof text) => {
    if (text[k].trim() !== it[k]) patch(it.id, { [k]: text[k].trim() });
  };

  const addService = () => {
    const v = service.trim();
    if (!v) return;
    if (!it.services.some((s) => s.toLowerCase() === v.toLowerCase())) {
      patch(it.id, { services: [...it.services, v] });
    }
    setService("");
  };
  const addLink = () => {
    if (!isHttp(linkUrl)) return setNote("The link must start with http:// or https://");
    setNote(null);
    patch(it.id, {
      links: [...it.links, { id: "", label: linkLabel.trim() || linkUrl.trim(), url: linkUrl.trim() }],
    });
    setLinkLabel("");
    setLinkUrl("");
  };

  /* ---- deliverables: standard set first, then any other format with a card ---- */
  const extra = Array.from(new Set(it.cards.map((c) => c.format))).filter((f) => !standard.includes(f));
  const rows = [...standard, ...extra].map((format) => ({
    format,
    cards: it.cards.filter((c) => c.format === format),
    skipped: it.skip.includes(format),
  }));
  const needed = rows.filter((r) => r.cards.length > 0 || !r.skipped);
  const started = needed.filter((r) => r.cards.length > 0).length;
  const published = needed.filter((r) => r.cards.some((c) => c.stage === "Published")).length;
  const pct = (n: number) => (needed.length ? `${(n / needed.length) * 100}%` : "0%");

  const createCard = async (format: string) => {
    if (creating) return;
    setCreating(format);
    setNote(null);
    try {
      const res = await fetch("/api/marketing/pipeline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${it.name} — ${label(format)}`,
          format,
          projectId: it.id,
          brief: [it.angle && `Angle: ${it.angle}`, it.summary].filter(Boolean).join("\n\n"),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not create the card");
      reload();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not create the card");
    } finally {
      setCreating(null);
    }
  };
  const toggleSkip = (format: string) =>
    patch(it.id, { skip: it.skip.includes(format) ? it.skip.filter((f) => f !== format) : [...it.skip, format] });

  const area = (k: "summary" | "challenge" | "contribution", placeholder: string) => (
    <textarea
      value={text[k]}
      onChange={(e) => setText((t) => ({ ...t, [k]: e.target.value }))}
      onBlur={() => saveText(k)}
      rows={3}
      placeholder={placeholder}
      className={`${inputCls} resize-y leading-relaxed`}
    />
  );

  return (
    <div className="anim-pop">
      <button onClick={onBack} className="mb-3 text-[13px] text-accent hover:underline">
        ← Publish Radar
      </button>

      <div className="mb-5 flex flex-wrap items-start gap-3">
        <span className="mt-2.5 h-3 w-3 shrink-0 rounded-full" style={{ background: it.color }} />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif-display text-3xl leading-tight">{it.name}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            delivered {fmtDate(it.deliveredAt)} · {it.source === "tracker" ? "from tracker" : "added by hand"}
            {it.updatedBy ? ` · last edited by ${it.updatedBy}` : ""}
          </p>
        </div>
        <span className={`${chip} ${STATUS[st].cls} mt-2`}>{STATUS[st].label}</span>
      </div>

      {(error || note) && (
        <p className="mb-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
          {error ?? note}
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        {/* ---------- master record ---------- */}
        <section className="glass-panel rounded-2xl border border-line/50 p-5">
          <div className="-mt-5">
            <Head>Summary</Head>
          </div>
          {area("summary", "What the project was, in two or three plain sentences.")}
          <Head>Challenge</Head>
          {area("challenge", "The problem the client had — what made this hard or necessary.")}
          <Head>Our contribution</Head>
          {area("contribution", "What SuperPixel actually did. Only what we can stand behind.")}

          <Head>Services</Head>
          <div className="flex flex-wrap items-center gap-1.5">
            {it.services.map((s) => (
              <span key={s} className={`${chip} group flex items-center gap-1 border-line/60 !text-[12px] text-ink-soft`}>
                {s}
                <button
                  onClick={() => patch(it.id, { services: it.services.filter((x) => x !== s) })}
                  aria-label={`Remove ${s}`}
                  className="text-ink-faint hover:text-red-600"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={service}
              onChange={(e) => setService(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addService()}
              onBlur={addService}
              placeholder="+ add service"
              className="w-[120px] rounded-full border border-dashed border-line/70 bg-transparent px-2.5 py-0.5 text-[12px] outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </div>

          <Head>NDA / publication restrictions</Head>
          <NdaSwitch value={it.nda} onChange={(nda) => patch(it.id, { nda })} />
          <textarea
            value={text.ndaNote}
            onChange={(e) => setText((t) => ({ ...t, ndaNote: e.target.value }))}
            onBlur={() => saveText("ndaNote")}
            rows={2}
            placeholder="Who confirmed it, and any condition"
            className={`${inputCls} mt-2 resize-y`}
          />
          <p className="mb-1.5 mt-3 text-xs text-ink-soft">Client has published on</p>
          <ChannelTicks channels={channels} pub={it.pub} onChange={(pub) => patch(it.id, { pub })} />

          <Head>Source links</Head>
          {it.links.map((l) => (
            <div key={l.id || l.url} className="group mb-1.5 flex items-center gap-2 rounded-xl border border-line/60 bg-card/70 px-3 py-1.5 text-[13px]">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-accent hover:underline">
                {l.label} ↗
              </a>
              <button
                onClick={() => patch(it.id, { links: it.links.filter((x) => x !== l) })}
                aria-label={`Remove ${l.label}`}
                title="Remove link"
                className="text-ink-faint opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Name — e.g. Final output" className={`${inputCls} !w-[40%] text-[13px]`} />
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addLink()}
              placeholder="https://drive.google.com/…"
              className={`${inputCls} text-[13px]`}
            />
            <button
              onClick={addLink}
              disabled={!linkUrl.trim()}
              className="shrink-0 rounded-xl border border-line/60 px-3 text-xs text-ink-soft hover:bg-parchment-dark/60 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </section>

        {/* ---------- deliverables ---------- */}
        <section className="glass-panel rounded-2xl border border-line/50 p-5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Deliverables</h2>
            <span className="text-xs text-ink-faint">
              {started} of {needed.length} started · {published} published
            </span>
          </div>
          <div className="mb-3 mt-2 flex h-2 overflow-hidden rounded-full bg-card/80">
            <span className="bg-emerald-500" style={{ width: pct(published) }} />
            <span className="bg-accent" style={{ width: pct(started - published) }} />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-line/50 text-[11px] uppercase tracking-wider text-ink-faint">
                  {["Deliverable", "Status", "Owner", "Reviewer", "Deadline", "Channel", "Next"].map((h) => (
                    <th key={h} className="px-2.5 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) =>
                  r.cards.length
                    ? r.cards.map((c) => {
                        const over = !!c.due && c.due < todayIso() && c.stage !== "Published";
                        return (
                          <tr
                            key={c.id}
                            onClick={() => onOpenCard(c.id)}
                            title={`Open “${c.title}” in the pipeline`}
                            className="cursor-pointer border-b border-line/30 last:border-0 hover:bg-accent-soft/40"
                          >
                            <td className="px-2.5 py-2.5">
                              <span className={`${chip} ${FORMAT_CLS[c.format] ?? "border-line/60 text-ink-soft"}`}>{label(c.format)}</span>
                              <span className="mt-1 block max-w-[240px] truncate text-[12px] text-ink-faint">{c.title}</span>
                            </td>
                            <td className="px-2.5 py-2.5">
                              <span className={`${chip} ${STAGE_CLS[c.stage] ?? "border-line/60 text-ink-soft"}`}>
                                {c.stage === "Bank" ? "In content bank" : c.stage}
                              </span>
                            </td>
                            <td className="px-2.5 py-2.5"><Person name={c.owner} /></td>
                            <td className="px-2.5 py-2.5"><Person name={c.reviewer} /></td>
                            <td className={`whitespace-nowrap px-2.5 py-2.5 ${over ? "font-semibold text-red-600 dark:text-red-300" : c.due ? "" : "text-ink-faint"}`}>
                              {c.due ? `${over ? "overdue " : ""}${fmtDue(c.due)}` : "—"}
                            </td>
                            <td className="px-2.5 py-2.5 text-ink-soft">{c.channel || "—"}</td>
                            <td className={`px-2.5 py-2.5 ${c.stage === "Published" ? "text-ink-faint" : ""}`}>{nextStep(c)}</td>
                          </tr>
                        );
                      })
                    : [
                        <tr key={r.format} className={`border-b border-line/30 last:border-0 ${r.skipped ? "opacity-50" : ""}`}>
                          <td className="px-2.5 py-2.5 font-semibold">{label(r.format)}</td>
                          <td className="px-2.5 py-2.5">
                            <span className={`${chip} border-line/60 text-ink-soft`}>{r.skipped ? "Not needed" : "Not started"}</span>
                          </td>
                          <td colSpan={4} className="px-2.5 py-2.5 text-ink-faint">—</td>
                          <td className="whitespace-nowrap px-2.5 py-2.5">
                            {!r.skipped && (
                              <button
                                onClick={() => createCard(r.format)}
                                disabled={it.nda !== "ok" || creating !== null}
                                title={it.nda !== "ok" ? "Clear the NDA status first" : "Create a pipeline card for this piece"}
                                className="mr-2 rounded-lg border border-line/60 px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                              >
                                {creating === r.format ? "Creating…" : "+ Create card"}
                              </button>
                            )}
                            <button onClick={() => toggleSkip(r.format)} className="text-xs text-ink-faint underline hover:text-ink-soft">
                              {r.skipped ? "needed after all" : "not needed"}
                            </button>
                          </td>
                        </tr>,
                      ]
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] text-ink-faint">
            {it.nda !== "ok"
              ? "Cards can be created once the NDA status is Cleared. "
              : ""}
            Click a started row to open its card in the Content Pipeline.
          </p>

          {it.angle && (
            <>
              <Head>Angle</Head>
              <p className="text-[13px] italic leading-relaxed text-ink-soft">“{it.angle}”</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Person({ name }: { name: string }) {
  if (!name) return <span className="text-ink-faint">—</span>;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Avatar name={name} />
      {first(name)}
    </span>
  );
}
