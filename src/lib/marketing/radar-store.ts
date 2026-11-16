import { promises as fs } from "fs";
import path from "path";
import { withLock } from "../mutex";
import { uid } from "../uid";

/**
 * Publish Radar state — marketing's manual record of what is safe to post
 * about each delivered project. The project list itself is NOT stored here:
 * it is read live from the shared projects store (done projects), so the
 * radar can never drift from the tracker. This file only holds what
 * marketing adds on top, keyed by project id, plus projects typed in by
 * hand that the tracker doesn't know (older work).
 *
 * v1 is fully manual: a person ticks where the client has published. The
 * automated weekly scan can later write the same `pub` map.
 */

export const RADAR_CHANNELS = ["Web", "YouTube", "Instagram", "LinkedIn", "Press"] as const;
export type RadarChannel = (typeof RADAR_CHANNELS)[number];

export const RADAR_FORMATS = [
  "Landing page",
  "SEO article",
  "EDM",
  "Social carousel",
  "Case study",
  "Portfolio",
  "Website entry",
  "Sales material",
] as const;

/**
 * The standard set of pieces every delivered project is expected to feed —
 * the project page lists these whether or not a card exists yet.
 */
export const STANDARD_DELIVERABLES = [
  "Social carousel",
  "EDM",
  "Case study",
  "Website entry",
  "Sales material",
] as const;

export interface SourceLink {
  id: string;
  label: string;
  url: string;
}

/** ask = not checked yet · ok = cleared to post · no = restricted / NDA */
export type NdaState = "ask" | "ok" | "no";

export interface RadarEntry {
  pub: Partial<Record<RadarChannel, boolean>>;
  nda: NdaState;
  ndaNote: string;
  angle: string;
  formats: string[];
  /** Master record — written once per project, reused for every piece. */
  summary: string;
  challenge: string;
  contribution: string;
  services: string[];
  links: SourceLink[];
  /** Standard deliverables marked "not needed" for this project. */
  skip: string[];
  /** "Not for marketing" — kept, but out of the default list. */
  excluded?: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

export interface ManualProject {
  id: string;
  name: string;
  client: string;
  deliveredAt?: string; // YYYY-MM-DD
  addedBy?: string;
}

export interface RadarDoc {
  entries: Record<string, RadarEntry>;
  manual: ManualProject[];
}

export const EMPTY_ENTRY: RadarEntry = {
  pub: {},
  nda: "ask",
  ndaNote: "",
  angle: "",
  formats: [],
  summary: "",
  challenge: "",
  contribution: "",
  services: [],
  links: [],
  skip: [],
};

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "marketing");
const FILE = path.join(DIR, "radar.json");

export async function readRadar(): Promise<RadarDoc> {
  try {
    const d = JSON.parse(await fs.readFile(FILE, "utf-8")) as Partial<RadarDoc>;
    return { entries: d.entries ?? {}, manual: Array.isArray(d.manual) ? d.manual : [] };
  } catch {
    return { entries: {}, manual: [] };
  }
}

async function write(doc: RadarDoc): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf-8");
  await fs.rename(tmp, FILE);
}

const mutate = <T>(fn: (doc: RadarDoc) => T): Promise<T> =>
  withLock("marketing-radar.json", async () => {
    const doc = await readRadar();
    const out = fn(doc);
    await write(doc);
    return out;
  });

export interface RadarPatch {
  pub?: Record<string, unknown>;
  nda?: unknown;
  ndaNote?: unknown;
  angle?: unknown;
  formats?: unknown;
  excluded?: unknown;
  summary?: unknown;
  challenge?: unknown;
  contribution?: unknown;
  services?: unknown;
  links?: unknown;
  skip?: unknown;
}

/** Merge a partial update into one project's entry (validated field by field). */
export function patchEntry(id: string, patch: RadarPatch, by: string): Promise<RadarEntry> {
  return mutate((doc) => {
    const cur: RadarEntry = { ...EMPTY_ENTRY, ...(doc.entries[id] ?? {}) };
    if (patch.pub && typeof patch.pub === "object") {
      const pub = { ...cur.pub };
      for (const ch of RADAR_CHANNELS) {
        if (ch in patch.pub) pub[ch] = patch.pub[ch] === true;
      }
      cur.pub = pub;
    }
    if (patch.nda === "ask" || patch.nda === "ok" || patch.nda === "no") cur.nda = patch.nda;
    if (typeof patch.ndaNote === "string") cur.ndaNote = patch.ndaNote.trim().slice(0, 600);
    if (typeof patch.angle === "string") cur.angle = patch.angle.trim().slice(0, 600);
    if (Array.isArray(patch.formats)) {
      const allowed = RADAR_FORMATS as readonly string[];
      cur.formats = allowed.filter((f) => (patch.formats as unknown[]).includes(f));
    }
    if (typeof patch.excluded === "boolean") cur.excluded = patch.excluded;
    for (const k of ["summary", "challenge", "contribution"] as const) {
      const v = patch[k];
      if (typeof v === "string") cur[k] = v.trim().slice(0, 1500);
    }
    if (Array.isArray(patch.services)) {
      cur.services = Array.from(
        new Set(
          (patch.services as unknown[])
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.trim().slice(0, 40))
            .filter(Boolean)
        )
      ).slice(0, 20);
    }
    if (Array.isArray(patch.links)) {
      // Rendered as clickable links — plain http(s) only.
      cur.links = (patch.links as unknown[])
        .map((l) => {
          const o = (l ?? {}) as Record<string, unknown>;
          const url = typeof o.url === "string" ? o.url.trim().slice(0, 500) : "";
          if (!/^https?:\/\/\S+$/i.test(url)) return null;
          const label = typeof o.label === "string" ? o.label.trim().slice(0, 140) : "";
          return { id: typeof o.id === "string" && o.id ? o.id.slice(0, 60) : uid("ln"), label: label || url, url };
        })
        .filter((l): l is SourceLink => l !== null)
        .slice(0, 30);
    }
    if (Array.isArray(patch.skip)) {
      const std = STANDARD_DELIVERABLES as readonly string[];
      cur.skip = std.filter((f) => (patch.skip as unknown[]).includes(f));
    }
    cur.updatedBy = by;
    cur.updatedAt = new Date().toISOString();
    doc.entries[id] = cur;
    return cur;
  });
}

export function addManual(
  input: { name: string; client?: string; deliveredAt?: string },
  by: string
): Promise<ManualProject> {
  return mutate((doc) => {
    const p: ManualProject = {
      id: uid("mkt"),
      name: input.name.trim().slice(0, 140),
      client: (input.client ?? "").trim().slice(0, 140),
      deliveredAt: /^\d{4}-\d{2}-\d{2}$/.test(input.deliveredAt ?? "") ? input.deliveredAt : undefined,
      addedBy: by,
    };
    doc.manual.push(p);
    return p;
  });
}

/** Only hand-added projects can be removed; tracker projects are hidden via `excluded`. */
export function removeManual(id: string): Promise<boolean> {
  return mutate((doc) => {
    const before = doc.manual.length;
    doc.manual = doc.manual.filter((m) => m.id !== id);
    if (doc.manual.length === before) return false;
    delete doc.entries[id];
    return true;
  });
}
