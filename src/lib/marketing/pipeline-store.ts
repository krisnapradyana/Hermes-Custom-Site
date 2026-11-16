import { promises as fs } from "fs";
import path from "path";
import { withLock } from "../mutex";
import { uid } from "../uid";
import { RADAR_FORMATS } from "./radar-store";

/**
 * Content Pipeline — one card per ANGLE (a piece of content), not per
 * project: a single project can feed an EDM, a carousel and a case study.
 * A card may link to a radar project (projectId) or stand alone (e.g. a
 * services landing page). Nothing here posts.
 *
 * The card is the workspace for the piece: brief, draft copy, asset links
 * and a comment thread live on it. Stage and reviewer changes write
 * automatic entries into that thread, so the thread doubles as the trail of
 * who moved or approved what.
 *
 * "Bank" is the content bank: ideas not on the board yet.
 */

export const PIPELINE_STAGES = ["Angle", "Drafting", "Review", "Scheduled", "Published"] as const;
export const BANK = "Bank";
export type PipelineStage = (typeof PIPELINE_STAGES)[number] | typeof BANK;
const ALL_STAGES: readonly string[] = [BANK, ...PIPELINE_STAGES];

/** Stages where the piece is (about to be) public — posting rules apply. */
export const PUBLIC_STAGES: readonly string[] = ["Scheduled", "Published"];

export const PIPELINE_CHANNELS = ["Email", "Website", "LinkedIn", "Instagram", "YouTube", "Other"] as const;

export interface CardAsset {
  id: string;
  label: string;
  url: string;
}

export interface CardComment {
  id: string;
  by: string;
  text: string;
  at: string;
  /** Automatic trail entry (stage moved, reviewer changed, approved…). */
  sys?: boolean;
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
  reviewer: string;
  channel: string; // one of PIPELINE_CHANNELS, or ""
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

/** Cards saved before the detail page existed lack the newer fields. */
function normalize(c: Partial<PipelineCard>): PipelineCard {
  return {
    ...(c as PipelineCard),
    reviewer: c.reviewer ?? "",
    channel: c.channel ?? "",
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
    return Array.isArray(d?.cards) ? (d.cards as Partial<PipelineCard>[]).map(normalize) : [];
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
  reviewer?: unknown;
  channel?: unknown;
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

/**
 * Apply the validated subset of `input` onto `card` (unknown/invalid fields
 * are ignored). Stage and reviewer changes are recorded in the thread.
 */
function apply(card: PipelineCard, input: CardInput, by: string, log: boolean): void {
  const title = str(input.title, 160);
  if (title) card.title = title;
  if ((RADAR_FORMATS as readonly string[]).includes(input.format as string)) card.format = input.format as string;
  if (ALL_STAGES.includes(input.stage as string) && input.stage !== card.stage) {
    if (log) card.comments.push(sys(by, `moved this from ${stageLabel(card.stage)} to ${stageLabel(input.stage as string)}`));
    card.stage = input.stage as PipelineStage;
  }
  if (input.projectId === null || input.projectId === "") card.projectId = undefined;
  else if (typeof input.projectId === "string") card.projectId = input.projectId.slice(0, 120);
  const owner = str(input.owner, 80);
  if (owner !== undefined) card.owner = owner;
  const reviewer = str(input.reviewer, 80);
  if (reviewer !== undefined && reviewer !== card.reviewer) {
    if (log) card.comments.push(sys(by, reviewer ? `set ${reviewer} as reviewer` : "removed the reviewer"));
    card.reviewer = reviewer;
  }
  if (input.channel === "" || (PIPELINE_CHANNELS as readonly string[]).includes(input.channel as string)) {
    card.channel = input.channel as string;
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
    card.assets = (input.assets as unknown[])
      .map((a) => {
        const o = (a ?? {}) as Record<string, unknown>;
        const u = str(o.url, 500) ?? "";
        if (!isHttp(u)) return null;
        return {
          id: typeof o.id === "string" && o.id ? o.id.slice(0, 60) : uid("as"),
          label: str(o.label, 140) || u,
          url: u,
        };
      })
      .filter((a): a is CardAsset => a !== null)
      .slice(0, 30);
  }
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
      reviewer: "",
      channel: "",
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
 * `comment` = a person's message; `trail` = an automatic entry (approved…).
 */
export function updateCard(
  id: string,
  input: CardInput,
  by: string,
  extra?: { comment?: string; trail?: string }
): Promise<PipelineCard | null> {
  return mutate((cards) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return { cards, out: null };
    if (extra?.trail) card.comments.push(sys(by, extra.trail));
    apply(card, input, by, !extra?.trail);
    const text = extra?.comment?.trim().slice(0, 2000);
    if (text) card.comments.push({ id: uid("cm"), by, text, at: new Date().toISOString() });
    card.comments = card.comments.slice(-300);
    card.updatedBy = by;
    card.updatedAt = new Date().toISOString();
    return { cards, out: card };
  });
}

export function deleteCard(id: string): Promise<boolean> {
  return mutate((cards) => {
    const next = cards.filter((c) => c.id !== id);
    return { cards: next, out: next.length !== cards.length };
  });
}
