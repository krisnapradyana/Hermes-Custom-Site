import { promises as fs } from "fs";
import path from "path";
import { withLock } from "../mutex";
import { uid } from "../uid";
import { RADAR_FORMATS } from "./radar-store";
import { FILE_URL_RE, deleteFile, fileIdFromUrl } from "./files-store";

/**
 * Content Pipeline — one card per ANGLE (a piece of content), not per
 * project: a single project can feed an EDM, a carousel and a case study.
 * A card may link to a radar project (projectId) or stand alone (e.g. a
 * services landing page). Nothing here posts.
 *
 * The card is the workspace for the piece: brief, draft copy, assets (Drive
 * links and uploaded previews) and a comment thread live on it. Stage,
 * approver and approval changes write automatic entries into that thread, so
 * the thread doubles as the trail of who moved or approved what.
 *
 * "Bank" is the content bank: ideas not on the board yet.
 */

export const PIPELINE_STAGES = ["Angle", "Drafting", "Review", "Scheduled", "Published"] as const;
export const BANK = "Bank";
export type PipelineStage = (typeof PIPELINE_STAGES)[number] | typeof BANK;
const ALL_STAGES: readonly string[] = [BANK, ...PIPELINE_STAGES];

/** Stages where the piece is (about to be) public — posting rules apply. */
export const PUBLIC_STAGES: readonly string[] = ["Scheduled", "Published"];

/** Where a piece goes out. "Other" is kept so older cards don't lose their value. */
export const PIPELINE_CHANNELS = [
  "Instagram",
  "LinkedIn",
  "YouTube",
  "TikTok",
  "Facebook",
  "Website",
  "Email",
  "Other",
] as const;

export interface CardAsset {
  id: string;
  label: string;
  /** An http(s) link, or /api/marketing/files/<id> for an uploaded file. */
  url: string;
  /** Set for uploads: the mime type decides whether a thumbnail is shown. */
  type?: string;
}

export interface CardComment {
  id: string;
  by: string;
  text: string;
  at: string;
  /** Automatic trail entry (stage moved, approver changed, approved…). */
  sys?: boolean;
}

export interface CardApproval {
  by: string;
  at: string;
}

/** What happened after publishing — entered by hand. */
export interface CardResult {
  period: string; // reporting period, e.g. "14–28 Nov 2026"
  source: string; // where the numbers come from
  numbers: string; // the measures relevant to this piece's objective
  lesson: string; // what to repeat or change next time
}

export const EMPTY_RESULT: CardResult = { period: "", source: "", numbers: "", lesson: "" };

export interface PipelineCard {
  id: string;
  title: string;
  format: string; // one of RADAR_FORMATS
  stage: PipelineStage;
  projectId?: string;
  owner: string; // display name, "" = unassigned
  /** Approvers — ALL must approve for the piece to leave Review. */
  reviewers: string[];
  /** Who has approved in the current review round (cleared when it re-enters Review). */
  approvals: CardApproval[];
  channels: string[]; // subset of PIPELINE_CHANNELS
  due?: string; // YYYY-MM-DD
  brief: string;
  draft: string;
  draftUrl: string;
  publishedUrl: string;
  notes: string;
  assets: CardAsset[];
  comments: CardComment[];
  result: CardResult;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "marketing");
const FILE = path.join(DIR, "pipeline.json");

/** Shapes saved by earlier versions: single `reviewer` / `channel`, no thread. */
type Stored = Partial<PipelineCard> & { reviewer?: string; channel?: string };

function normalize(c: Stored): PipelineCard {
  const { reviewer, channel, ...rest } = c;
  return {
    ...(rest as PipelineCard),
    reviewers: Array.isArray(c.reviewers) ? c.reviewers : reviewer ? [reviewer] : [],
    approvals: Array.isArray(c.approvals) ? c.approvals : [],
    channels: Array.isArray(c.channels) ? c.channels : channel ? [channel] : [],
    brief: c.brief ?? "",
    draft: c.draft ?? "",
    draftUrl: c.draftUrl ?? "",
    publishedUrl: c.publishedUrl ?? "",
    notes: c.notes ?? "",
    assets: Array.isArray(c.assets) ? c.assets : [],
    comments: Array.isArray(c.comments) ? c.comments : [],
    result: { ...EMPTY_RESULT, ...(c.result ?? {}) },
  };
}

export async function readCards(): Promise<PipelineCard[]> {
  try {
    const d = JSON.parse(await fs.readFile(FILE, "utf-8"));
    return Array.isArray(d?.cards) ? (d.cards as Stored[]).map(normalize) : [];
  } catch {
    return [];
  }
}

async function write(cards: PipelineCard[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ cards }, null, 2), "utf-8");
  await fs.rename(tmp, FILE);
}

const mutate = <T>(fn: (cards: PipelineCard[]) => { cards: PipelineCard[]; out: T }): Promise<T> =>
  withLock("marketing-pipeline.json", async () => {
    const res = fn(await readCards());
    await write(res.cards);
    return res.out;
  });

export interface CardInput {
  title?: unknown;
  format?: unknown;
  stage?: unknown;
  projectId?: unknown;
  owner?: unknown;
  reviewers?: unknown;
  channels?: unknown;
  due?: unknown;
  brief?: unknown;
  draft?: unknown;
  draftUrl?: unknown;
  publishedUrl?: unknown;
  notes?: unknown;
  assets?: unknown;
  result?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const isHttp = (s: string) => /^https?:\/\/\S+$/i.test(s);
/** Links are shown as clickable hrefs — only plain http(s) is accepted. */
const url = (v: unknown) => {
  const s = str(v, 500);
  if (s === undefined) return undefined;
  return s === "" || isHttp(s) ? s : undefined;
};

const sys = (by: string, text: string): CardComment => ({
  id: uid("cm"),
  by,
  text,
  at: new Date().toISOString(),
  sys: true,
});

const stageLabel = (s: string) => (s === BANK ? "the content bank" : s);

/** True once every approver has approved (and there is at least one). */
export function fullyApproved(card: PipelineCard): boolean {
  return card.reviewers.length > 0 && card.reviewers.every((r) => card.approvals.some((a) => a.by === r));
}

/** Approvers who still have to act in this round. */
export function pendingReviewers(card: PipelineCard): string[] {
  return card.reviewers.filter((r) => !card.approvals.some((a) => a.by === r));
}

/**
 * Apply the validated subset of `input` onto `card` (unknown/invalid fields
 * are ignored). Stage and approver changes are recorded in the thread.
 */
function apply(card: PipelineCard, input: CardInput, by: string, log: boolean): void {
  const title = str(input.title, 160);
  if (title) card.title = title;
  if ((RADAR_FORMATS as readonly string[]).includes(input.format as string)) card.format = input.format as string;
  if (ALL_STAGES.includes(input.stage as string) && input.stage !== card.stage) {
    if (log) card.comments.push(sys(by, `moved this from ${stageLabel(card.stage)} to ${stageLabel(input.stage as string)}`));
    card.stage = input.stage as PipelineStage;
    // Every trip into Review is a fresh round.
    if (card.stage === "Review") card.approvals = [];
  }
  if (input.projectId === null || input.projectId === "") card.projectId = undefined;
  else if (typeof input.projectId === "string") card.projectId = input.projectId.slice(0, 120);
  const owner = str(input.owner, 80);
  if (owner !== undefined) card.owner = owner;
  if (Array.isArray(input.reviewers)) {
    const next = Array.from(
      new Set(
        (input.reviewers as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim().slice(0, 80))
          .filter(Boolean)
      )
    ).slice(0, 8);
    const added = next.filter((r) => !card.reviewers.includes(r));
    const removed = card.reviewers.filter((r) => !next.includes(r));
    if (log && added.length) card.comments.push(sys(by, `added ${added.join(", ")} as approver`));
    if (log && removed.length) card.comments.push(sys(by, `removed ${removed.join(", ")} as approver`));
    card.reviewers = next;
    card.approvals = card.approvals.filter((a) => next.includes(a.by));
  }
  if (Array.isArray(input.channels)) {
    const allowed = PIPELINE_CHANNELS as readonly string[];
    card.channels = allowed.filter((c) => (input.channels as unknown[]).includes(c));
  }
  if (input.due === null || input.due === "") card.due = undefined;
  else if (typeof input.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.due)) card.due = input.due;
  const brief = str(input.brief, 4000);
  if (brief !== undefined) card.brief = brief;
  const draft = str(input.draft, 60_000);
  if (draft !== undefined) card.draft = draft;
  const draftUrl = url(input.draftUrl);
  if (draftUrl !== undefined) card.draftUrl = draftUrl;
  const publishedUrl = url(input.publishedUrl);
  if (publishedUrl !== undefined) card.publishedUrl = publishedUrl;
  const notes = str(input.notes, 2000);
  if (notes !== undefined) card.notes = notes;
  if (input.result && typeof input.result === "object") {
    const r = input.result as Record<string, unknown>;
    card.result = {
      period: str(r.period, 80) ?? card.result.period,
      source: str(r.source, 160) ?? card.result.source,
      numbers: str(r.numbers, 1500) ?? card.result.numbers,
      lesson: str(r.lesson, 1500) ?? card.result.lesson,
    };
  }
  if (Array.isArray(input.assets)) {
    // Uploaded files can only be KEPT through this path (matched by url to
    // one already on the card) — new uploads arrive through addUpload().
    const mine = new Map(card.assets.filter((a) => FILE_URL_RE.test(a.url)).map((a) => [a.url, a]));
    card.assets = (input.assets as unknown[])
      .map((a): CardAsset | null => {
        const o = (a ?? {}) as Record<string, unknown>;
        const u = str(o.url, 500) ?? "";
        const kept = mine.get(u);
        if (kept) return { ...kept, label: str(o.label, 140) || kept.label };
        if (!isHttp(u)) return null;
        return {
          id: typeof o.id === "string" && o.id ? o.id.slice(0, 60) : uid("as"),
          label: str(o.label, 140) || u,
          url: u,
        };
      })
      .filter((a): a is CardAsset => a !== null)
      .slice(0, MAX_ASSETS);
  }
}

export const MAX_ASSETS = 30;

/** Uploaded files a change dropped from a card — removed from disk after the write. */
function orphaned(before: CardAsset[], after: CardAsset[]): string[] {
  const kept = new Set(after.map((a) => a.url));
  return before
    .filter((a) => !kept.has(a.url))
    .map((a) => fileIdFromUrl(a.url))
    .filter((id): id is string => id !== null);
}

export function createCard(input: CardInput, by: string): Promise<PipelineCard | null> {
  return mutate((cards) => {
    const now = new Date().toISOString();
    const card: PipelineCard = {
      id: uid("card"),
      title: "",
      format: RADAR_FORMATS[0],
      stage: "Angle",
      owner: "",
      reviewers: [],
      approvals: [],
      channels: [],
      brief: "",
      draft: "",
      draftUrl: "",
      publishedUrl: "",
      notes: "",
      assets: [],
      comments: [],
      result: { ...EMPTY_RESULT },
      createdBy: by,
      createdAt: now,
      updatedBy: by,
      updatedAt: now,
    };
    apply(card, input, by, false);
    if (!card.title) return { cards, out: null };
    return { cards: [...cards, card], out: card };
  });
}

/**
 * Update fields and/or append to the thread in one locked write.
 * `comment` = a person's message; `trail` = an automatic entry (approved…);
 * `approve` = record this person's approval; `clearApprovals` = start over.
 */
export async function updateCard(
  id: string,
  input: CardInput,
  by: string,
  extra?: { comment?: string; trail?: string; approve?: boolean; clearApprovals?: boolean }
): Promise<PipelineCard | null> {
  let gone: string[] = [];
  const out = await mutate((cards) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return { cards, out: null };
    const before = card.assets;
    if (extra?.trail) card.comments.push(sys(by, extra.trail));
    apply(card, input, by, !extra?.trail);
    if (extra?.approve && !card.approvals.some((a) => a.by === by)) {
      card.approvals.push({ by, at: new Date().toISOString() });
    }
    if (extra?.clearApprovals) card.approvals = [];
    const text = extra?.comment?.trim().slice(0, 2000);
    if (text) card.comments.push({ id: uid("cm"), by, text, at: new Date().toISOString() });
    card.comments = card.comments.slice(-300);
    card.updatedBy = by;
    card.updatedAt = new Date().toISOString();
    gone = orphaned(before, card.assets);
    return { cards, out: card };
  });
  await Promise.all(gone.map(deleteFile));
  return out;
}

/** Attach a freshly uploaded file to a card. Null = no such card, or it is full. */
export function addUpload(
  id: string,
  asset: CardAsset,
  by: string
): Promise<PipelineCard | null> {
  return mutate((cards) => {
    const card = cards.find((c) => c.id === id);
    if (!card || card.assets.length >= MAX_ASSETS) return { cards, out: null };
    card.assets.push(asset);
    card.updatedBy = by;
    card.updatedAt = new Date().toISOString();
    return { cards, out: card };
  });
}

export async function deleteCard(id: string): Promise<boolean> {
  let gone: string[] = [];
  const ok = await mutate((cards) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return { cards, out: false };
    gone = orphaned(card.assets, []);
    return { cards: cards.filter((c) => c.id !== id), out: true };
  });
  await Promise.all(gone.map(deleteFile));
  return ok;
}
