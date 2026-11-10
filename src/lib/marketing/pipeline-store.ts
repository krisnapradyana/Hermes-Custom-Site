import { promises as fs } from "fs";
import path from "path";
import { withLock } from "../mutex";
import { uid } from "../uid";
import { RADAR_FORMATS } from "./radar-store";

/**
 * Content Pipeline — one card per ANGLE (a piece of content), not per
 * project: a single project can feed an EDM, a carousel and a case study.
 * A card may link to a radar project (projectId) or stand alone (e.g. a
 * services landing page). Stages run left to right; nothing here posts.
 */

export const PIPELINE_STAGES = ["Angle", "Drafting", "Review", "Scheduled", "Published"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** Stages where the piece is (about to be) public — posting rules apply. */
export const PUBLIC_STAGES: readonly PipelineStage[] = ["Scheduled", "Published"];

export interface PipelineCard {
  id: string;
  title: string;
  format: string; // one of RADAR_FORMATS
  stage: PipelineStage;
  projectId?: string;
  owner: string; // display name, "" = unassigned
  due?: string; // YYYY-MM-DD
  draftUrl: string;
  publishedUrl: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "marketing");
const FILE = path.join(DIR, "pipeline.json");

export async function readCards(): Promise<PipelineCard[]> {
  try {
    const d = JSON.parse(await fs.readFile(FILE, "utf-8"));
    return Array.isArray(d?.cards) ? (d.cards as PipelineCard[]) : [];
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
  due?: unknown;
  draftUrl?: unknown;
  publishedUrl?: unknown;
  notes?: unknown;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
/** Links are shown as clickable hrefs — only plain http(s) is accepted. */
const url = (v: unknown) => {
  const s = str(v, 500);
  if (s === undefined) return undefined;
  return s === "" || /^https?:\/\//i.test(s) ? s : undefined;
};

/** Apply the validated subset of `input` onto `card` (unknown/invalid fields are ignored). */
function apply(card: PipelineCard, input: CardInput): void {
  const title = str(input.title, 160);
  if (title) card.title = title;
  if ((RADAR_FORMATS as readonly string[]).includes(input.format as string)) card.format = input.format as string;
  if ((PIPELINE_STAGES as readonly string[]).includes(input.stage as string)) card.stage = input.stage as PipelineStage;
  if (input.projectId === null || input.projectId === "") card.projectId = undefined;
  else if (typeof input.projectId === "string") card.projectId = input.projectId.slice(0, 120);
  const owner = str(input.owner, 80);
  if (owner !== undefined) card.owner = owner;
  if (input.due === null || input.due === "") card.due = undefined;
  else if (typeof input.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.due)) card.due = input.due;
  const draftUrl = url(input.draftUrl);
  if (draftUrl !== undefined) card.draftUrl = draftUrl;
  const publishedUrl = url(input.publishedUrl);
  if (publishedUrl !== undefined) card.publishedUrl = publishedUrl;
  const notes = str(input.notes, 2000);
  if (notes !== undefined) card.notes = notes;
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
      draftUrl: "",
      publishedUrl: "",
      notes: "",
      createdBy: by,
      createdAt: now,
      updatedBy: by,
      updatedAt: now,
    };
    apply(card, input);
    if (!card.title) return { cards, out: null };
    return { cards: [...cards, card], out: card };
  });
}

export function updateCard(id: string, input: CardInput, by: string): Promise<PipelineCard | null> {
  return mutate((cards) => {
    const card = cards.find((c) => c.id === id);
    if (!card) return { cards, out: null };
    apply(card, input);
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
