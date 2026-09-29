import { promises as fs } from "fs";
import path from "path";
import { withLock } from "./mutex";

/**
 * Post-mortem reflections — the studio's Google Form ("Post-Mortem
 * Reflection") reborn inside the platform, question-for-question, so
 * producers evaluate on the exact data they've always used:
 *   involvement, went-well, challenges, improvements + five 1–5 self-ratings.
 * Name and project come from the session/context instead of being typed.
 *
 * One JSON file per project in DATA_DIR/postmortem/. The wrap flow (flagship
 * projects) stores the responsible person's response first — submitting it is
 * what finally marks the project done — then the rest of the involved team is
 * invited to add theirs. Hermes distills all responses into the "wisdom" doc.
 */

export interface PmRatings {
  perception: number; // 1..5 — level of perception for this project
  communication: number; // 1..5
  speed: number; // 1..5
  creativity: number; // 1..5
  outcome: number; // 1..5 — satisfaction with the final output
}

export interface PmResponse {
  userKey: string; // Slack id
  name: string;
  involvement: string; // "What is your involvement/responsibility?"
  wentWell: string;
  challenges: string;
  improvements: string;
  ratings: PmRatings;
  /** True for the wrap submission that finalized "done". */
  isWrap?: boolean;
  at: string;
}

export interface PmDoc {
  projectId: string;
  responses: PmResponse[];
  /** Hermes-distilled wisdom (markdown) + provenance. */
  distilled?: { md: string; at: string; fromResponses: number };
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "postmortem");
const file = (projectId: string) => path.join(DIR, `${projectId.replace(/[^\w.-]+/g, "_")}.json`);

export async function readPostmortem(projectId: string): Promise<PmDoc> {
  try {
    return JSON.parse(await fs.readFile(file(projectId), "utf-8")) as PmDoc;
  } catch {
    return { projectId, responses: [] };
  }
}

async function write(doc: PmDoc): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${file(doc.projectId)}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2), "utf-8");
  await fs.rename(tmp, file(doc.projectId));
}

const clamp15 = (n: unknown): number =>
  Math.min(5, Math.max(1, Math.round(typeof n === "number" && Number.isFinite(n) ? n : 3)));

/** Upsert one member's response (a person can revise theirs until distilled). */
export function submitResponse(
  projectId: string,
  r: Omit<PmResponse, "at">
): Promise<PmDoc> {
  return withLock(`pm-${projectId}`, async () => {
    const doc = await readPostmortem(projectId);
    const response: PmResponse = {
      ...r,
      involvement: r.involvement.trim().slice(0, 500),
      wentWell: r.wentWell.trim().slice(0, 4000),
      challenges: r.challenges.trim().slice(0, 4000),
      improvements: r.improvements.trim().slice(0, 4000),
      ratings: {
        perception: clamp15(r.ratings.perception),
        communication: clamp15(r.ratings.communication),
        speed: clamp15(r.ratings.speed),
        creativity: clamp15(r.ratings.creativity),
        outcome: clamp15(r.ratings.outcome),
      },
      at: new Date().toISOString(),
    };
    const idx = doc.responses.findIndex((x) => x.userKey === r.userKey);
    if (idx >= 0) response.isWrap = doc.responses[idx].isWrap || r.isWrap; // keep the wrap mark
    if (idx >= 0) doc.responses[idx] = response;
    else doc.responses.push(response);
    await write(doc);
    return doc;
  });
}

export function saveDistilled(projectId: string, md: string): Promise<PmDoc> {
  return withLock(`pm-${projectId}`, async () => {
    const doc = await readPostmortem(projectId);
    doc.distilled = { md, at: new Date().toISOString(), fromResponses: doc.responses.length };
    await write(doc);
    return doc;
  });
}
