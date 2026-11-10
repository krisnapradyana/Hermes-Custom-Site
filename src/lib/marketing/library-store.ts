import { promises as fs } from "fs";
import path from "path";
import { withLock } from "../mutex";
import { uid } from "../uid";

/**
 * Library & Rules — the reference shelf. Two kinds of content:
 *   - References: links to the team's approved documents (always the live
 *     doc, never a copy). Editable; stored in data/marketing/library.json,
 *     seeded with the four source docs the checkers were built from.
 *   - House rules: a readable digest of what the checker prompts enforce.
 *     Defined HERE in code, next to the prompts, so the two can't drift —
 *     change a prompt, update the digest, bump the prompt version.
 */

export interface Reference {
  id: string;
  title: string;
  url: string;
  note: string;
  addedBy?: string;
}

const drive = (id: string) => `https://drive.google.com/open?id=${id}`;

const SEED: Reference[] = [
  {
    id: "ref-edm-training",
    title: "EDM Training Sheet (Kelvin standard)",
    url: drive("1RQlr14IBWtb38xRGx4svvCZUU9_inzumKs6yaodELXA"),
    note: "The EDM standard, the review prompts, the ban list and the carousel rules.",
  },
  {
    id: "ref-landing-spec",
    title: "Landing Page — SuperPixel.sg",
    url: drive("14CMw4OpZ451BBjUKvyoVLclQMyRH1YUxKf8HL86ZXck"),
    note: "Page-by-page copy spec: meta, H1, sections, FAQ.",
  },
  {
    id: "ref-seo-drafts",
    title: "Article Draft — SEO",
    url: drive("1iHgTfvbS4lGwNm1OdtUYXJ_Sq7c8bXKtcQsUhV8tfxU"),
    note: "Approved and in-progress SEO articles.",
  },
  {
    id: "ref-edm-copy",
    title: "Copy for EDM",
    url: drive("1b5aQHvK8rXIni7RCMdeDpcc7vzGoPCb6yoLuAXtubP8"),
    note: "Past EDMs — use as tone and structure reference.",
  },
];

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "marketing");
const FILE = path.join(DIR, "library.json");

/** Until someone edits the list, the seed IS the list. */
export async function readReferences(): Promise<Reference[]> {
  try {
    const d = JSON.parse(await fs.readFile(FILE, "utf-8"));
    return Array.isArray(d?.references) ? (d.references as Reference[]) : SEED;
  } catch {
    return SEED;
  }
}

async function write(references: Reference[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ references }, null, 2), "utf-8");
  await fs.rename(tmp, FILE);
}

export function addReference(
  input: { title: string; url: string; note?: string },
  by: string
): Promise<Reference> {
  return withLock("marketing-library.json", async () => {
    const list = await readReferences();
    const ref: Reference = {
      id: uid("ref"),
      title: input.title.trim().slice(0, 140),
      url: input.url.trim().slice(0, 500),
      note: (input.note ?? "").trim().slice(0, 300),
      addedBy: by,
    };
    await write([...list, ref]);
    return ref;
  });
}

export function removeReference(id: string): Promise<boolean> {
  return withLock("marketing-library.json", async () => {
    const list = await readReferences();
    const next = list.filter((r) => r.id !== id);
    if (next.length === list.length) return false;
    await write(next);
    return true;
  });
}

/* ---------------- house rules (digest of the checker prompts) ---------------- */

export interface RuleBlock {
  title: string;
  /** "chips" renders short phrases as pills; "list" as sentences. */
  kind: "chips" | "list";
  tone?: "bad" | "good";
  items: string[];
  source: string;
}

export const HOUSE_RULES: RuleBlock[] = [
  {
    title: "Positioning",
    kind: "list",
    items: [
      "SuperPixel is an animation studio first: story, motion, character, worldbuilding. XR and interactivity are a delivery layer, not the identity.",
      "Sound like an experienced production partner and advisor — not a studio that says every client needs our service.",
      "Be willing to say when a format is unnecessary, or when something simpler fits better.",
    ],
    source: "EDM standard · SEO checker",
  },
  {
    title: "Do not write",
    kind: "chips",
    tone: "bad",
    items: [
      "seamless",
      "leveraged",
      "elevated",
      "choreographed",
      "spike energy",
      "payoff loops",
      "cosy mid-moment",
      "will go viral",
      "guaranteed results",
      "audiences will love it",
      "will increase engagement",
      "will outperform",
      "the best",
      "always",
      "unforgettable experience",
      "make your brand stand out",
    ],
    source: "EDM ban list · SEO overclaim list",
  },
  {
    title: "Write instead",
    kind: "chips",
    tone: "good",
    items: [
      "works smoothly",
      "used",
      "made",
      "planned each step",
      "gets people excited",
      "clear reward",
      "can",
      "may",
      "is designed to",
      "can help",
      "is better suited to",
      "in our experience",
      "often requires",
    ],
    source: "EDM replacements · SEO measured language",
  },
  {
    title: "Claims",
    kind: "list",
    items: [
      "Promise only what we control: design, content states, visual feedback, testing, delivery formats. Never virality, sales or audience love.",
      "No invented facts, clients, numbers or results. No pseudo-precision without a source or real internal data.",
      "A related project is not proof of something we did not do — frame it honestly as a related production lesson.",
      "Prices and market ranges need a source, a year and the word “indicative”.",
    ],
    source: "SEO checker · EDM standard",
  },
  {
    title: "EDM shape",
    kind: "list",
    items: [
      "Scene → Problem → Idea → Experience → Result. Concrete moments before any framework.",
      "Filmable test: if a sentence can’t be filmed (see / do / next), rewrite it.",
      "Body 180–210 words, 1–2 line paragraphs, no sentence over about 18 words.",
      "One bullet list of 3–5 things people actually did.",
      "Subject + one-line preheader. CTA: one confident invitation and one clear offer.",
    ],
    source: "EDM standard",
  },
  {
    title: "SEO article",
    kind: "list",
    items: [
      "State in one sentence what the article helps the reader decide — and keep every section on it.",
      "Deliver what the title promises, and answer the search intent early.",
      "Information gain over word count: production experience, real constraints, trade-offs, things buyers misunderstand.",
      "“Singapore” needs real local context, not repetition as a keyword.",
      "Case studies: context → constraint → decision → production consequence → lesson.",
    ],
    source: "SEO checker",
  },
  {
    title: "Call to action",
    kind: "list",
    items: [
      "Concrete and low-hype — ask for what we need: screen specifications, location, campaign objective, intended audience behaviour.",
      "The CTA should continue the logic of the piece, not switch into a sales voice.",
    ],
    source: "SEO checker",
  },
];
