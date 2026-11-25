"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BANK,
  PUBLIC_STAGES,
  CHECKER_FOR,
  type Board,
  type Card,
  Avatar,
  FORMAT_CLS,
  chip,
  hasApproved,
  inputCls,
  isOverdue,
  pendingOf,
} from "./pipeline-shared";

/**
 * Card detail — the workspace for one piece of content, sliding in from the
 * right: who/when, brief, draft copy, asset links and the comment thread
 * (which also carries the automatic trail of moves and approvals).
 * Selects save on change; text fields save when you click out of them.
 */

type Send = (id: string, body: Record<string, unknown>, optimistic?: Partial<Card>) => Promise<boolean>;

const isHttp = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function CardPanel({
  card,
  board,
  people,
  send,
  okToGoPublic,
  onRunChecker,
  reload,
  error,
  onClose,
  onDeleted,
}: {
  card: Card;
  board: Board;
  people: string[];
  send: Send;
  okToGoPublic: (c: { projectId?: string }, stage: string) => boolean;
  onRunChecker: (format: string, draft: string) => void;
  reload: () => Promise<void> | void;
  /** The pipeline's last save / action error — shown here too, since this panel covers the page. */
  error: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  // Local copies of the text fields while typing (saved on blur).
  const [title, setTitle] = useState(card.title);
  const [brief, setBrief] = useState(card.brief);
  const [draft, setDraft] = useState(card.draft);
  const [draftUrl, setDraftUrl] = useState(card.draftUrl);
  const [publishedUrl, setPublishedUrl] = useState(card.publishedUrl);
  const [result, setResult] = useState(card.result);
  const [comment, setComment] = useState("");
  const [assetLabel, setAssetLabel] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const project = board.projects.find((p) => p.id === card.projectId);
  const inBank = card.stage === BANK;
  const stageIdx = board.stages.indexOf(card.stage);
  const next = stageIdx >= 0 && stageIdx < board.stages.length - 1 ? board.stages[stageIdx + 1] : null;
  // Approvals: every listed approver must approve. Someone on the list who
  // has already approved has nothing left to decide; leadership can step in.
  const listed = card.reviewers.includes(board.me);
  const iApproved = hasApproved(card, board.me);
  const mayDecide = listed ? !iApproved : board.isLead || card.reviewers.length === 0;
  const pending = pendingOf(card);
  const othersPending = pending.filter((n) => n !== board.me);
  const [sharing, setSharing] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const checker = CHECKER_FOR[card.format];
  // Keep a current owner selectable even if they left the team list.
  const names = useMemo(
    () => Array.from(new Set([...people, card.owner].filter(Boolean))),
    [people, card.owner]
  );
  const toggleChannel = (ch: string) => {
    const channels = card.channels.includes(ch) ? card.channels.filter((x) => x !== ch) : [...card.channels, ch];
    set({ channels });
  };

  /** Upload dropped / chosen files one by one; the server attaches each to the card. */
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setNote(null);
    setUploading((n) => n + files.length);
    const problems: string[] = [];
    for (const file of files) {
      try {
        const form = new FormData();
        form.set("card", card.id);
        form.set("file", file);
        const res = await fetch("/api/marketing/files", { method: "POST", body: form });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          problems.push(`${file.name}: ${d.error ?? "upload failed"}`);
        }
      } catch {
        problems.push(`${file.name}: upload failed`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await reload();
    if (problems.length) setNote(problems.join(" · "));
  };

  const set = (change: Partial<Card>) => send(card.id, change, change);
  const saveText = (key: "title" | "brief" | "draft", value: string) => {
    const v = value.trim();
    if (v === card[key]) return;
    if (key === "title" && v.length < 2) return setTitle(card.title);
    set({ [key]: v });
  };
  const saveUrl = (key: "draftUrl" | "publishedUrl", value: string, reset: (v: string) => void) => {
    const v = value.trim();
    if (v === card[key]) return;
    if (v && !isHttp(v)) {
      setNote("Links must start with http:// or https://");
      return reset(card[key]);
    }
    setNote(null);
    set({ [key]: v });
  };

  const saveResult = (k: keyof Card["result"]) => {
    if (result[k].trim() !== card.result[k]) set({ result: { ...card.result, [k]: result[k].trim() } });
  };
  const hasResult = Object.values(card.result).some(Boolean);
  const remind = () => send(card.id, { action: "remind" });

  const moveTo = (stage: string) => {
    if (stage === card.stage) return;
    if (!okToGoPublic(card, stage)) return;
    set({ stage });
  };
  const changeProject = (projectId: string) => {
    if (PUBLIC_STAGES.includes(card.stage) && !okToGoPublic({ projectId: projectId || undefined }, card.stage)) return;
    send(card.id, { projectId }, { projectId: projectId || undefined });
  };

  const addAsset = () => {
    if (!isHttp(assetUrl)) return setNote("Asset link must start with http:// or https://");
    setNote(null);
    send(card.id, {
      assets: [...card.assets, { label: assetLabel.trim() || assetUrl.trim(), url: assetUrl.trim() }],
    });
    setAssetLabel("");
    setAssetUrl("");
  };
  const removeAsset = (id: string) => {
    const assets = card.assets.filter((a) => a.id !== id);
    send(card.id, { assets }, { assets });
  };

  const postComment = async () => {
    const text = comment.trim();
    if (!text) return;
    setComment("");
    const ok = await send(card.id, { action: "comment", text });
    if (!ok) setComment(text);
    else requestAnimationFrame(() => threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const approve = () => {
    // Only the approval that completes the round moves the piece to Scheduled.
    const completes = !listed || othersPending.length === 0;
    if (completes && !okToGoPublic(card, "Scheduled")) return;
    send(card.id, { action: "approve" });
  };
  const requestChanges = () => {
    const text = prompt("What needs to change? (optional — it is added to the comments)");
    if (text === null) return;
    send(card.id, { action: "request_changes", text });
  };

  const remove = async () => {
    if (!confirm(`Delete "${card.title}"? Its brief, draft and comments go with it. This cannot be undone.`)) return;
    await fetch(`/api/marketing/pipeline?id=${encodeURIComponent(card.id)}`, { method: "DELETE" });
    onDeleted();
  };

  const sel = `${inputCls} !py-1.5 text-[13px]`;
  const people_n = card.comments.filter((m) => !m.sys).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="glass-ice anim-slide flex h-full w-full max-w-[660px] flex-col border-l border-line/50">
        {/* ---- header ---- */}
        <div className="border-b border-line/50 px-5 pb-3 pt-4">
          <div className="flex items-start gap-2">
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => saveText("title", title)}
              rows={title.length > 48 ? 2 : 1}
              aria-label="Title"
              className="min-w-0 flex-1 resize-none rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-[19px] font-semibold leading-snug outline-none hover:border-line/60 focus:border-accent"
            />
            <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-0.5 text-xl text-ink-soft hover:bg-parchment-dark/60">
              ×
            </button>
          </div>
          {inBank ? (
            <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-line/60 px-3 py-2 text-[13px] text-ink-soft">
              In the content bank — not on the board yet.
              <button
                onClick={() => send(card.id, { stage: "Angle", owner: card.owner || board.me }, { stage: "Angle" })}
                className="ml-auto rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
              >
                Pick up →
              </button>
            </div>
          ) : (
            <div className="mt-2.5 flex gap-1">
              {board.stages.map((s, i) => (
                <button
                  key={s}
                  onClick={() => moveTo(s)}
                  title={`Move to ${s}`}
                  className={`flex-1 rounded-md py-1 text-[11px] transition-colors ${
                    i === stageIdx
                      ? "bg-accent-soft font-bold text-accent"
                      : i < stageIdx
                        ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
                        : "bg-card/70 text-ink-faint hover:text-ink-soft"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ---- body ---- */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-4">
          {error && (
            <p className="mb-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Owner">
              <div className="flex items-center gap-2">
                <Avatar name={card.owner} />
                <select value={card.owner} onChange={(e) => set({ owner: e.target.value })} className={sel}>
                  <option value="">Unassigned</option>
                  {names.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Format">
              <select value={card.format} onChange={(e) => set({ format: e.target.value })} className={sel}>
                {board.formats.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label={isOverdue(card) ? "Due — overdue" : "Due"}>
              <input
                type="date"
                value={card.due ?? ""}
                onChange={(e) => send(card.id, { due: e.target.value }, { due: e.target.value || undefined })}
                className={`${sel} ${isOverdue(card) ? "!border-red-500/60 text-red-600 dark:text-red-300" : ""}`}
              />
            </Field>
            <Field label="Project">
              <select value={card.projectId ?? ""} onChange={(e) => changeProject(e.target.value)} className={sel}>
                <option value="">None — general content</option>
                {board.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.nda === "no" ? " (restricted)" : p.nda === "ask" ? " (NDA not checked)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {project && (project.nda !== "ok" || !project.clientPublished) && (
            <p
              className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
                project.nda === "no"
                  ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }`}
            >
              {project.nda === "no"
                ? "This project is Restricted on the Publish Radar — the piece cannot be scheduled or published."
                : project.nda !== "ok"
                  ? "NDA status for this project has not been cleared on the Publish Radar."
                  : "The client has not published this project anywhere yet — do not post before they do."}
            </p>
          )}

          <Section title="Channels" hint="where this piece goes out">
            <div className="flex flex-wrap gap-1.5">
              {board.channels.map((ch) => {
                const on = card.channels.includes(ch);
                return (
                  <label
                    key={ch}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] transition-colors ${
                      on ? "border-accent bg-accent-soft text-accent" : "border-line/60 text-ink-soft hover:bg-parchment-dark/50"
                    }`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleChannel(ch)} className="accent-[var(--color-accent)]" />
                    {ch}
                  </label>
                );
              })}
            </div>
          </Section>

          <Section
            title="Approvers"
            hint={card.reviewers.length > 1 ? "all must approve" : undefined}
          >
            {card.reviewers.length === 0 && (
              <p className="mb-2 text-xs text-ink-faint">Nobody yet — without an approver, anyone with access can approve.</p>
            )}
            {card.reviewers.map((r) => {
              const ok = card.approvals.find((a) => a.by === r);
              return (
                <div key={r} className="group mb-1.5 flex items-center gap-2 text-[13px]">
                  <Avatar name={r} />
                  <span className="min-w-0 flex-1 truncate">{r}</span>
                  {card.stage === "Review" || ok ? (
                    ok ? (
                      <span className="text-xs text-emerald-700 dark:text-emerald-300">
                        ✓ Approved {new Date(ok.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700 dark:text-amber-300">Waiting</span>
                    )
                  ) : null}
                  <button
                    onClick={() => set({ reviewers: card.reviewers.filter((x) => x !== r) })}
                    aria-label={`Remove ${r}`}
                    title="Remove approver"
                    className="text-ink-faint opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {people.some((x) => !card.reviewers.includes(x)) && (
              <select
                value=""
                onChange={(e) => e.target.value && set({ reviewers: [...card.reviewers, e.target.value] })}
                className={`${sel} !w-auto text-ink-soft`}
                aria-label="Add approver"
              >
                <option value="">+ Add approver</option>
                {people
                  .filter((x) => !card.reviewers.includes(x))
                  .map((x) => (
                    <option key={x}>{x}</option>
                  ))}
              </select>
            )}
          </Section>

          <Section title="Brief">
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onBlur={() => saveText("brief", brief)}
              rows={4}
              placeholder="What this piece is for, who reads it, and the one idea it should land."
              className={`${inputCls} resize-y leading-relaxed`}
            />
          </Section>

          <Section
            title="Draft copy"
            action={
              checker && (
                <button
                  onClick={() => onRunChecker(checker, draft.trim())}
                  disabled={draft.trim().length < 40}
                  title={draft.trim().length < 40 ? "Paste the draft text below to run the checker" : "Open this draft in Checker Studio"}
                  className="rounded-lg border border-line/60 px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  Run checker →
                </button>
              )
            }
          >
            <div className="mb-2 flex items-center gap-2">
              <input
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onBlur={() => saveUrl("draftUrl", draftUrl, setDraftUrl)}
                placeholder="Google Doc link — https://docs.google.com/…"
                className={`${inputCls} text-[13px]`}
              />
              {card.draftUrl && (
                <a href={card.draftUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-accent underline">
                  Open ↗
                </a>
              )}
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => saveText("draft", draft)}
              rows={7}
              placeholder="Or paste the draft text here. The checker reads this box."
              className={`${inputCls} resize-y leading-relaxed`}
            />
          </Section>

          {(PUBLIC_STAGES.includes(card.stage) || card.publishedUrl) && (
            <Section title="Published link">
              <div className="flex items-center gap-2">
                <input
                  value={publishedUrl}
                  onChange={(e) => setPublishedUrl(e.target.value)}
                  onBlur={() => saveUrl("publishedUrl", publishedUrl, setPublishedUrl)}
                  placeholder="https://… where it went live"
                  className={`${inputCls} text-[13px]`}
                />
                {card.publishedUrl && (
                  <a href={card.publishedUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-accent underline">
                    Open ↗
                  </a>
                )}
              </div>
            </Section>
          )}

          {(card.stage === "Published" || hasResult) && (
            <Section title="Results and lesson" hint="how it did, entered by hand">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={result.period}
                  onChange={(e) => setResult((r) => ({ ...r, period: e.target.value }))}
                  onBlur={() => saveResult("period")}
                  placeholder="Reporting period — e.g. 14–28 Nov"
                  className={`${inputCls} text-[13px]`}
                />
                <input
                  value={result.source}
                  onChange={(e) => setResult((r) => ({ ...r, source: e.target.value }))}
                  onBlur={() => saveResult("source")}
                  placeholder="Data source — e.g. Mailchimp report"
                  className={`${inputCls} text-[13px]`}
                />
              </div>
              <textarea
                value={result.numbers}
                onChange={(e) => setResult((r) => ({ ...r, numbers: e.target.value }))}
                onBlur={() => saveResult("numbers")}
                rows={3}
                placeholder="The numbers that matter for this piece's goal — e.g. opens, clicks, replies, enquiries. Only what the source shows."
                className={`${inputCls} mt-2 resize-y leading-relaxed`}
              />
              <textarea
                value={result.lesson}
                onChange={(e) => setResult((r) => ({ ...r, lesson: e.target.value }))}
                onBlur={() => saveResult("lesson")}
                rows={2}
                placeholder="Lesson — one thing to repeat or change next time."
                className={`${inputCls} mt-2 resize-y leading-relaxed`}
              />
            </Section>
          )}

          <Section title="Previews and files" hint="drop images or PDFs, or link from Drive">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                upload(Array.from(e.dataTransfer.files));
              }}
              className={`rounded-xl border border-dashed p-2 transition-colors ${
                dragOver ? "border-accent bg-accent-soft/50" : "border-line/70"
              }`}
            >
              {card.assets.some((a) => a.type) && (
                <div className="mb-2 grid grid-cols-4 gap-2">
                  {card.assets
                    .filter((a) => a.type)
                    .map((a) => (
                      <div key={a.id} className="group relative">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={a.label}
                          className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-line/60 bg-card/70"
                        >
                          {a.type?.startsWith("image/") ? (
                            // Access-gated same-origin file; next/image would need a public loader.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.url} alt={a.label} loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <span className="px-1 text-center text-[11px] text-ink-soft">
                              PDF
                              <span className="mt-0.5 block truncate text-ink-faint">{a.label}</span>
                            </span>
                          )}
                        </a>
                        <button
                          onClick={() => removeAsset(a.id)}
                          aria-label={`Delete ${a.label}`}
                          title="Delete file"
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white opacity-0 focus:opacity-100 group-hover:opacity-100"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                </div>
              )}
              <div className="flex items-center justify-center gap-2 py-2 text-[12.5px] text-ink-faint">
                {uploading > 0 ? (
                  `Uploading ${uploading} ${uploading === 1 ? "file" : "files"}…`
                ) : (
                  <>
                    Drop images or PDFs here, or
                    <button onClick={() => fileInput.current?.click()} className="text-accent underline">
                      choose files
                    </button>
                    <span>· 10 MB each</span>
                  </>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    upload(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            <div className="mt-2">
              {card.assets
                .filter((a) => !a.type)
                .map((a) => (
                  <div key={a.id} className="group mb-1.5 flex items-center gap-2 rounded-xl border border-line/60 bg-card/70 px-3 py-1.5 text-[13px]">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-accent hover:underline">
                      {a.label} ↗
                    </a>
                    <button
                      onClick={() => removeAsset(a.id)}
                      aria-label={`Remove ${a.label}`}
                      title="Remove link"
                      className="text-ink-faint opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
              <div className="flex gap-2">
                <input value={assetLabel} onChange={(e) => setAssetLabel(e.target.value)} placeholder="Name" className={`${inputCls} !w-[38%] text-[13px]`} />
                <input
                  value={assetUrl}
                  onChange={(e) => setAssetUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addAsset()}
                  placeholder="Drive link, e.g. for video — https://drive.google.com/…"
                  className={`${inputCls} text-[13px]`}
                />
                <button
                  onClick={addAsset}
                  disabled={!assetUrl.trim()}
                  className="shrink-0 rounded-xl border border-line/60 px-3 text-xs text-ink-soft hover:bg-parchment-dark/60 disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>
          </Section>

          {note && <p className="mt-3 text-xs text-red-600 dark:text-red-300">{note}</p>}

          <Section title="Comments" hint={people_n ? String(people_n) : undefined}>
            {card.comments.length === 0 && <p className="mb-2 text-xs text-ink-faint">No comments yet.</p>}
            {card.comments.map((m) =>
              m.sys ? (
                <p key={m.id} className="mb-2 ml-7 text-[11.5px] text-ink-faint">
                  ● {m.by} {m.text} · {when(m.at)}
                </p>
              ) : (
                <div key={m.id} className="mb-3 flex gap-2">
                  <Avatar name={m.by} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-ink-faint">
                      <b className="font-semibold text-ink">{m.by}</b> · {when(m.at)}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[13px] text-ink-soft">{m.text}</div>
                  </div>
                </div>
              )
            )}
            <div ref={threadEnd} />
            <div className="flex gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && postComment()}
                placeholder="Write a comment…"
                className={`${inputCls} text-[13px]`}
              />
              <button
                onClick={postComment}
                disabled={!comment.trim()}
                className="shrink-0 rounded-xl bg-accent px-4 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </Section>
        </div>

        {/* ---- footer ---- */}
        <div className="flex items-center gap-2 border-t border-line/50 px-5 py-3">
          <button onClick={remove} className="text-xs text-red-600 underline dark:text-red-300">
            Delete card
          </button>
          <span className={`${chip} ${FORMAT_CLS[card.format] ?? "border-line/60 text-ink-soft"} ml-1`}>{card.format}</span>
          <button
            onClick={() => setSharing(true)}
            className="ml-1 rounded-lg border border-line/60 px-2.5 py-1.5 text-xs text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            Share to Slack
          </button>
          <span className="ml-auto" />
          {card.stage === "Review" ? (
            mayDecide ? (
              <>
                <button onClick={requestChanges} className="rounded-xl border border-line/60 px-4 py-2 text-sm text-ink-soft hover:bg-parchment-dark/60">
                  Request changes
                </button>
                <button onClick={approve} className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
                  {listed && card.reviewers.length > 1
                    ? `Approve (${card.approvals.length + 1} of ${card.reviewers.length})`
                    : "Approve"}
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 truncate text-[13px] text-ink-soft">
                  {iApproved ? "You approved · " : ""}
                  {pending.length ? `waiting for ${pending.map((n) => n.split(" ")[0]).join(", ")}` : "waiting for approval"}
                </span>
                {othersPending.length > 0 && (
                  <button onClick={remind} className="shrink-0 rounded-xl border border-line/60 px-4 py-2 text-sm text-ink-soft hover:bg-parchment-dark/60">
                    Remind on Slack
                  </button>
                )}
              </>
            )
          ) : next && !inBank ? (
            <button onClick={() => moveTo(next)} className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover">
              {next === "Review" ? "Send for review →" : `Move to ${next} →`}
            </button>
          ) : card.stage === "Published" ? (
            <span className="text-[13px] font-medium text-emerald-700 dark:text-emerald-300">Published</span>
          ) : null}
        </div>
      </aside>
      {sharing && (
        <ShareDialog
          card={card}
          defaultChannel={project?.slackChannel ?? ""}
          send={send}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}

/* ---------------- share to Slack ---------------- */

interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
}

function ShareDialog({
  card,
  defaultChannel,
  send,
  onClose,
}: {
  card: Card;
  defaultChannel: string;
  send: Send;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<SlackChannel[] | null>(null);
  const [channel, setChannel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/marketing/slack-channels")
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d: { channels: SlackChannel[] }) => {
        setChannels(d.channels);
        // Start on the project's own channel when the bot is in it.
        const want = defaultChannel.replace(/^#/, "").toLowerCase();
        const hit = want ? d.channels.find((c) => c.id.toLowerCase() === want || c.name.toLowerCase() === want) : undefined;
        if (hit) setChannel(hit.id);
      })
      .catch(() => setChannels([]));
  }, [defaultChannel]);

  const people = Array.from(new Set([card.owner, ...card.reviewers].filter(Boolean)));
  const post = async () => {
    if (busy || !channel) return;
    setBusy(true);
    const ok = await send(card.id, { action: "share", channel, text });
    if (ok) onClose();
    else setBusy(false); // the panel's error banner says why
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="glass-ice anim-pop-center w-full max-w-md rounded-2xl p-6">
        <h2 className="font-serif-display text-2xl">Share to Slack</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Posts one message about this card as the Hermes bot
          {people.length ? `, mentioning ${people.map((n) => n.split(" ")[0]).join(", ")}` : ""}.
        </p>
        <div className="mt-4 flex flex-col gap-2.5">
          {channels === null ? (
            <p className="text-sm text-ink-faint">Loading channels…</p>
          ) : channels.length === 0 ? (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              No channels found. Invite the Hermes bot to the channel in Slack first, then reopen this window.
            </p>
          ) : (
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls} aria-label="Slack channel">
              <option value="">Choose a channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.isPrivate ? "🔒 " : "# "}
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What changed? (optional) — e.g. Draft v2 is in, please check the opening."
            className={`${inputCls} resize-y`}
          />
          <p className="text-[11px] text-ink-faint">
            Only channels the Hermes bot has been invited to are listed.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft hover:bg-parchment-dark/60">
            Cancel
          </button>
          <button
            onClick={post}
            disabled={busy || !channel}
            className="rounded-xl bg-accent px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "Posting…" : "Post to Slack"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{title}</h3>
        {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}
