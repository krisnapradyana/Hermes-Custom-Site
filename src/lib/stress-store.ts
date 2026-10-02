import { promises as fs } from "fs";
import path from "path";
import { withLock } from "./mutex";
import { Scores, bandOf, Band } from "./stress-instrument";

/**
 * Sprint Stress Check storage — one studio-wide team (alpha), bi-weekly
 * windows computed from a fixed epoch so every fortnight is a window.
 * ALPHA DEVIATION from the spec: the window is open its whole fortnight
 * (spec: last 2 working days only) so the rollout isn't gated on sprint
 * calendar wiring. One response per user per window; resubmit overwrites.
 *
 * Privacy (per spec): individual scores are stored but only ever served to
 * their owner; the meter/aggregates layer serves bands to leadership and
 * means only when n ≥ MIN_AGGREGATE_N.
 */

export interface StressResponse {
  userKey: string;
  name: string;
  windowLabel: string; // e.g. "S22"
  submittedAt: string;
  answers: Record<string, number>; // raw values, before reversal (auditable)
  freeText: string | null;
  scores: Scores;
  instrumentVersion: string;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "stress-check.json");
export const MIN_AGGREGATE_N = 5;

// Fortnights counted from Monday 2026-01-05 (studio sprint epoch).
const EPOCH_UTC = Date.UTC(2026, 0, 5);
const FORTNIGHT = 14 * 86_400_000;
const TZ_OFF = Number(process.env.TIMECLOCK_TZ_OFFSET_MIN ?? "480") * 60_000;

export interface Window {
  label: string;
  opensAt: number;
  closesAt: number;
}

export function currentWindow(now = Date.now()): Window {
  const idx = Math.floor((now + TZ_OFF - EPOCH_UTC) / FORTNIGHT);
  const opensAt = EPOCH_UTC + idx * FORTNIGHT - TZ_OFF;
  return { label: `S${idx + 1}`, opensAt, closesAt: opensAt + FORTNIGHT };
}

async function readAll(): Promise<StressResponse[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8")) as StressResponse[];
  } catch {
    return [];
  }
}

async function writeAll(list: StressResponse[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf-8");
  await fs.rename(tmp, FILE);
}

/** Upsert the caller's response for the current window (resubmit overwrites). */
export function submitStress(r: Omit<StressResponse, "submittedAt">): Promise<StressResponse> {
  return withLock("stress-check", async () => {
    const list = await readAll();
    const response: StressResponse = { ...r, submittedAt: new Date().toISOString() };
    const idx = list.findIndex(
      (x) => x.userKey === r.userKey && x.windowLabel === r.windowLabel
    );
    if (idx >= 0) list[idx] = response;
    else list.push(response);
    await writeAll(list);
    return response;
  });
}

/** The caller's own responses, newest first — only ever for the owner. */
export async function myResponses(userKey: string): Promise<StressResponse[]> {
  return (await readAll())
    .filter((r) => r.userKey === userKey)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export type MeterState = Band | "invalid" | "none";

export interface MeterEntry {
  userKey: string;
  name: string;
  state: MeterState;
  /** Set only for invalid: when they last assessed. */
  lastAt?: string;
}

/**
 * Per-member meter states for the LEADERSHIP view:
 *   band        — scored response inside the current window
 *   invalid     — has history, but nothing in the current window (stale > 2w)
 *   none        — never assessed
 * NOTE: serving bands per member is the studio's policy choice (differs from
 * the spec's aggregates-only default); the access gate lives in the API.
 */
export async function meterStates(
  roster: { userKey: string; name: string }[]
): Promise<MeterEntry[]> {
  const win = currentWindow();
  const all = await readAll();
  return roster.map((m) => {
    const mine = all
      .filter((r) => r.userKey === m.userKey)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    const current = mine.find(
      (r) => r.windowLabel === win.label && r.scores.stress_score !== null
    );
    if (current) return { ...m, state: bandOf(current.scores.stress_score!) };
    if (mine.length > 0) return { ...m, state: "invalid" as const, lastAt: mine[0].submittedAt };
    return { ...m, state: "none" as const };
  });
}

export interface StressAggregate {
  windowLabel: string;
  responseN: number;
  published: boolean;
  meanStress: number | null;
  means: { dass: number | null; cbiPersonal: number | null; cbiWork: number | null };
  pctFlagged: { dass: number | null; cbiPersonal: number | null; cbiWork: number | null } | null;
  comments: string[] | null; // anonymised, shuffled, null unless ≥ 3
}

export async function aggregate(windowLabel?: string): Promise<StressAggregate> {
  const win = windowLabel ?? currentWindow().label;
  const rows = (await readAll()).filter(
    (r) => r.windowLabel === win && r.scores.stress_score !== null
  );
  const n = rows.length;
  const published = n >= MIN_AGGREGATE_N;
  const mean = (vals: (number | null)[]) => {
    const v = vals.filter((x): x is number => x !== null);
    return v.length === 0 ? null : Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
  };
  const pct = (sel: (r: StressResponse) => boolean) =>
    n === 0 ? null : Math.round(((rows.filter(sel).length / n) * 100) * 10) / 10;
  const comments = rows.map((r) => r.freeText).filter((t): t is string => !!t);
  // Shuffle on every read so order never identifies anyone.
  for (let i = comments.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [comments[i], comments[j]] = [comments[j], comments[i]];
  }
  return {
    windowLabel: win,
    responseN: n,
    published,
    meanStress: published ? mean(rows.map((r) => r.scores.stress_score)) : null,
    means: published
      ? {
          dass: mean(rows.map((r) => r.scores.dass_stress)),
          cbiPersonal: mean(rows.map((r) => r.scores.cbi_personal)),
          cbiWork: mean(rows.map((r) => r.scores.cbi_work)),
        }
      : { dass: null, cbiPersonal: null, cbiWork: null },
    pctFlagged: published
      ? {
          dass: pct((r) => r.scores.flags.dass),
          cbiPersonal: pct((r) => r.scores.flags.cbi_personal),
          cbiWork: pct((r) => r.scores.flags.cbi_work),
        }
      : null,
    comments: published && comments.length >= 3 ? comments : null,
  };
}
