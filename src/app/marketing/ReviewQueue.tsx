"use client";

import { useMemo } from "react";
import { type Board, type Card, Avatar, FORMAT_CLS, chip, hasApproved, pendingOf, waitsOn } from "./pipeline-shared";

/**
 * Review queue — the pipeline seen as "who is waiting on whom":
 *   1. cards waiting for YOUR review (approve / request changes right here)
 *   2. your cards waiting on someone else
 *   3. everything else in review
 * plus the decision trail across all cards, read from each card's thread
 * (the automatic "approved" / "requested changes" entries).
 */

type Send = (id: string, body: Record<string, unknown>, optimistic?: Partial<Card>) => Promise<boolean>;

const DAY = 86_400_000;
/** When the card entered Review — the last automatic "… to Review" entry. */
function inReviewSince(c: Card): number {
  for (let i = c.comments.length - 1; i >= 0; i--) {
    const m = c.comments[i];
    if (m.sys && m.text.endsWith("to Review")) return new Date(m.at).getTime();
  }
  return new Date(c.updatedAt).getTime();
}
function waiting(c: Card): { text: string; late: boolean } {
  const days = Math.floor((Date.now() - inReviewSince(c)) / DAY);
  return {
    text: days <= 0 ? "since today" : `waiting ${days} ${days === 1 ? "day" : "days"}`,
    late: days >= 3,
  };
}

interface Decision {
  id: string;
  cardId: string;
  title: string;
  approved: boolean;
  by: string;
  at: string;
  note: string;
}

export function ReviewQueue({
  board,
  send,
  okToGoPublic,
  onOpen,
}: {
  board: Board;
  send: Send;
  okToGoPublic: (c: { projectId?: string }, stage: string) => boolean;
  onOpen: (id: string) => void;
}) {
  const inReview = useMemo(
    () => board.cards.filter((c) => c.stage === "Review").sort((a, b) => inReviewSince(a) - inReviewSince(b)),
    [board.cards]
  );
  const mine = inReview.filter((c) => waitsOn(c, board.me));
  const sent = inReview.filter((c) => c.owner === board.me && !mine.includes(c));
  const others = inReview.filter((c) => !mine.includes(c) && !sent.includes(c));

  const decisions = useMemo(() => {
    const out: Decision[] = [];
    for (const c of board.cards) {
      c.comments.forEach((m, i) => {
        if (!m.sys) return;
        // A partial approval ("approved this (1 of 3) …") is progress, not the decision.
        if (m.text.startsWith("approved this (")) return;
        const approved = m.text.startsWith("approved this");
        if (!approved && !m.text.startsWith("requested changes")) return;
        // The reviewer's note, if any, is the comment written in the same action.
        const n = c.comments[i + 1];
        const note =
          n && !n.sys && n.by === m.by && Math.abs(new Date(n.at).getTime() - new Date(m.at).getTime()) < 5000
            ? n.text
            : "";
        out.push({ id: m.id, cardId: c.id, title: c.title, approved, by: m.by, at: m.at, note });
      });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  }, [board.cards]);

  const approve = (c: Card) => {
    if (!okToGoPublic(c, "Scheduled")) return;
    send(c.id, { action: "approve" });
  };
  const requestChanges = (c: Card) => {
    const text = prompt("What needs to change? (optional — it is added to the card's comments)");
    if (text === null) return;
    send(c.id, { action: "request_changes", text });
  };
  // A listed approver who already approved has nothing left to decide.
  const mayDecide = (c: Card) =>
    c.reviewers.includes(board.me)
      ? !hasApproved(c, board.me)
      : board.isLead || c.reviewers.length === 0;

  const Row = ({ c, actions, remind }: { c: Card; actions: boolean; remind?: boolean }) => {
    const w = waiting(c);
    const project = board.projects.find((p) => p.id === c.projectId);
    return (
      <div
        className={`mb-2 flex flex-wrap items-center gap-3 rounded-xl border bg-card/80 px-3.5 py-2.5 ${
          waitsOn(c, board.me) ? "border-amber-500/60 shadow-[inset_3px_0_0_rgb(245_158_11)]" : "border-line/60"
        }`}
      >
        <button onClick={() => onOpen(c.id)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[14px] font-semibold hover:text-accent">{c.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-faint">
            <span className={`${chip} ${FORMAT_CLS[c.format] ?? "border-line/60 text-ink-soft"}`}>{c.format}</span>
            {project?.name ?? "general content"} ·
            <span className="flex items-center gap-1">
              <Avatar name={c.owner} size={16} />
              {c.owner ? c.owner.split(" ")[0] : "no owner"}
            </span>
            →
            {c.reviewers.length ? (
              <span className="flex items-center gap-1">
                {c.reviewers.map((r) => (
                  <span
                    key={r}
                    title={`${r}: ${hasApproved(c, r) ? "approved" : "waiting"}`}
                    className={`flex items-center ${hasApproved(c, r) ? "" : "opacity-50"}`}
                  >
                    <Avatar name={r} size={16} />
                    {hasApproved(c, r) && <span className="text-emerald-600 dark:text-emerald-300">✓</span>}
                  </span>
                ))}
                {c.reviewers.length > 1 && (
                  <span>
                    {c.approvals.length}/{c.reviewers.length}
                  </span>
                )}
              </span>
            ) : (
              "no approver"
            )}
          </span>
        </button>
        <span className={`whitespace-nowrap text-[12.5px] ${w.late ? "font-semibold text-red-600 dark:text-red-300" : "text-ink-faint"}`}>
          {w.text}
        </span>
        {actions && mayDecide(c) ? (
          <>
            <button
              onClick={() => requestChanges(c)}
              className="rounded-lg border border-line/60 px-3 py-1.5 text-xs text-ink-soft hover:bg-parchment-dark/60"
            >
              Request changes
            </button>
            <button onClick={() => approve(c)} className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white hover:bg-accent-hover">
              Approve
            </button>
          </>
        ) : remind && pendingOf(c).some((r) => r !== board.me) ? (
          <button
            onClick={() => send(c.id, { action: "remind" })}
            className="rounded-lg border border-line/60 px-3 py-1.5 text-xs text-ink-soft hover:bg-parchment-dark/60"
          >
            Remind on Slack
          </button>
        ) : (
          <button onClick={() => onOpen(c.id)} className="rounded-lg border border-line/60 px-3 py-1.5 text-xs text-ink-soft hover:bg-parchment-dark/60">
            Open
          </button>
        )}
      </div>
    );
  };

  const Group = ({
    title,
    cards,
    actions,
    remind,
    empty,
  }: {
    title: string;
    cards: Card[];
    actions: boolean;
    remind?: boolean;
    empty: string;
  }) => (
    <div className="mb-5">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        {title} <span className="font-normal text-ink-faint">· {cards.length}</span>
      </h2>
      {cards.length ? (
        cards.map((c) => <Row key={c.id} c={c} actions={actions} remind={remind} />)
      ) : (
        <p className="rounded-xl border border-dashed border-line/60 px-3.5 py-3 text-[13px] text-ink-faint">{empty}</p>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div>
        <Group title="Waiting for your approval" cards={mine} actions empty="Nothing is waiting on you." />
        <Group
          title="Your cards waiting on someone else"
          cards={sent}
          actions={false}
          remind
          empty="None of your cards are in review."
        />
        {/* Leadership can decide on any card, so they get the buttons here too. */}
        <Group title="Everything else in review" cards={others} actions={board.isLead} empty="Nothing else is in review." />
      </div>

      <section className="glass-panel rounded-2xl border border-line/50 p-5">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Recent decisions</h2>
        {decisions.length === 0 && <p className="text-[13px] text-ink-faint">No approvals or change requests yet.</p>}
        {decisions.map((d) => (
          <button
            key={d.id}
            onClick={() => onOpen(d.cardId)}
            className="flex w-full gap-3 border-b border-line/30 py-2 text-left text-[12.5px] last:border-0 hover:bg-accent-soft/30"
          >
            <time className="w-[88px] shrink-0 whitespace-nowrap text-ink-faint">
              {new Date(d.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </time>
            <span className="min-w-0 text-ink-soft">
              <b className={d.approved ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                {d.approved ? "Approved" : "Changes requested"}
              </b>{" "}
              · {d.title} — by {d.by}
              {d.note && <span className="block italic text-ink-faint">“{d.note}”</span>}
            </span>
          </button>
        ))}
        <p className="mt-3 text-[11px] text-ink-faint">
          Each decision is also recorded in the comments of its card, with who and when.
        </p>
      </section>
    </div>
  );
}
