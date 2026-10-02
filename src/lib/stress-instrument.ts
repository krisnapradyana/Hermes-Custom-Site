/**
 * Sprint Stress Check — instrument v1 + scoring, verbatim from the technical
 * specification (Oct 2, 2026). Item text, scales and weights are FIXED; do
 * not reword items or change scoring after launch or trend lines break.
 *
 * Instruments: DASS-21 Stress subscale (Lovibond & Lovibond 1995, public
 * domain; two-week time frame is a disclosed adaptation) + Copenhagen
 * Burnout Inventory personal & work subscales (Kristensen et al. 2005,
 * free to use). Self-check, not a diagnosis.
 */

export const INSTRUMENT_VERSION = "v1";

export type ScaleId = "dass" | "cbi_freq" | "cbi_degree";

export const SCALES: Record<ScaleId, { value: number; label: string }[]> = {
  dass: [
    { value: 0, label: "Did not apply to me at all" },
    { value: 1, label: "Applied to some degree, or some of the time" },
    { value: 2, label: "Applied to a considerable degree, or a good part of the time" },
    { value: 3, label: "Applied very much, or most of the time" },
  ],
  cbi_freq: [
    { value: 0, label: "Never / almost never" },
    { value: 25, label: "Seldom" },
    { value: 50, label: "Sometimes" },
    { value: 75, label: "Often" },
    { value: 100, label: "Always" },
  ],
  cbi_degree: [
    { value: 0, label: "To a very low degree" },
    { value: 25, label: "To a low degree" },
    { value: 50, label: "Somewhat" },
    { value: 75, label: "To a high degree" },
    { value: 100, label: "To a very high degree" },
  ],
};

export interface Item {
  id: string;
  text: string;
  scale: ScaleId;
}

/** Screen 1 stem: "Over the past two weeks, how much did each statement apply to you?" */
export const DASS_ITEMS: Item[] = [
  { id: "D1", text: "I found it hard to wind down", scale: "dass" },
  { id: "D2", text: "I tended to over-react to situations", scale: "dass" },
  { id: "D3", text: "I felt that I was using a lot of nervous energy", scale: "dass" },
  { id: "D4", text: "I found myself getting agitated", scale: "dass" },
  { id: "D5", text: "I found it difficult to relax", scale: "dass" },
  { id: "D6", text: "I was intolerant of anything that kept me from getting on with what I was doing", scale: "dass" },
  { id: "D7", text: "I felt that I was rather touchy", scale: "dass" },
];

/** Screen 2 stem: "Over the past two weeks…" */
export const CBI_P_ITEMS: Item[] = [
  { id: "P1", text: "How often did you feel tired?", scale: "cbi_freq" },
  { id: "P2", text: "How often were you physically exhausted?", scale: "cbi_freq" },
  { id: "P3", text: "How often were you emotionally exhausted?", scale: "cbi_freq" },
  { id: "P4", text: 'How often did you think "I can\'t take it anymore"?', scale: "cbi_freq" },
  { id: "P5", text: "How often did you feel worn out?", scale: "cbi_freq" },
  { id: "P6", text: "How often did you feel weak and susceptible to illness?", scale: "cbi_freq" },
];

/** Screen 3 stem: "Thinking about your work over the past two weeks…" */
export const CBI_W_ITEMS: Item[] = [
  { id: "W1", text: "Was your work emotionally exhausting?", scale: "cbi_degree" },
  { id: "W2", text: "Did you feel burnt out because of your work?", scale: "cbi_degree" },
  { id: "W3", text: "Did your work frustrate you?", scale: "cbi_degree" },
  { id: "W4", text: "How often did you feel worn out at the end of the working day?", scale: "cbi_freq" },
  { id: "W5", text: "How often were you exhausted in the morning at the thought of another day at work?", scale: "cbi_freq" },
  { id: "W6", text: "How often did you feel that every working hour was tiring for you?", scale: "cbi_freq" },
  { id: "W7", text: "How often did you have enough energy for family and friends during leisure time?", scale: "cbi_freq" },
];

export const ALL_SCORED_IDS = [...DASS_ITEMS, ...CBI_P_ITEMS, ...CBI_W_ITEMS].map((i) => i.id);

export const FREE_TEXT_ITEM = {
  id: "X1",
  text: "Anything behind these numbers you want your lead to know? (Shown to your lead only as part of the team's anonymous comments.)",
  maxLength: 1000,
};

// ---- scoring (reference implementation from the spec, unchanged) -----------

export type Answers = Record<string, number | null | undefined>;

export interface Scores {
  dass_raw: number | null; // 0–21
  dass_stress: number | null; // 0–100
  cbi_personal: number | null; // 0–100
  cbi_work: number | null; // 0–100
  stress_score: number | null; // 0–100
  flags: { dass: boolean; cbi_personal: boolean; cbi_work: boolean };
}

const DASS_IDS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"];
const CBI_P_IDS = ["P1", "P2", "P3", "P4", "P5", "P6"];
const CBI_W_IDS = ["W1", "W2", "W3", "W4", "W5", "W6", "W7"];
const REVERSED: Record<string, number> = { W7: 100 }; // id -> scale max

const r1 = (v: number) => Math.round(v * 10) / 10;

function value(answers: Answers, id: string): number | null {
  const v = answers[id];
  if (v === null || v === undefined) return null;
  return id in REVERSED ? REVERSED[id] - v : v;
}

function meanIfEnough(answers: Answers, ids: string[], minAnswered: number): number | null {
  const vals = ids.map((id) => value(answers, id)).filter((v): v is number => v !== null);
  if (vals.length < minAnswered) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function score(answers: Answers): Scores {
  const dassVals = DASS_IDS.map((id) => value(answers, id));
  const dassComplete = dassVals.every((v) => v !== null);
  const dass_raw = dassComplete ? (dassVals as number[]).reduce((a, b) => a + b, 0) : null;
  const dass_stress = dass_raw === null ? null : r1((dass_raw * 100) / 21);

  const cbiP = meanIfEnough(answers, CBI_P_IDS, 3);
  const cbiW = meanIfEnough(answers, CBI_W_IDS, 4);
  const cbi_personal = cbiP === null ? null : r1(cbiP);
  const cbi_work = cbiW === null ? null : r1(cbiW);

  const stress_score =
    dass_stress === null || cbi_personal === null || cbi_work === null
      ? null
      : r1((dass_stress + cbi_personal + cbi_work) / 3);

  return {
    dass_raw,
    dass_stress,
    cbi_personal,
    cbi_work,
    stress_score,
    flags: {
      dass: dass_raw !== null && dass_raw >= 8,
      cbi_personal: cbi_personal !== null && cbi_personal >= 50,
      cbi_work: cbi_work !== null && cbi_work >= 50,
    },
  };
}

/** Composite bands — internal colour convention, NOT a validated cutoff.
 * (Studio naming: the spec's "very high" is shown as "Severe".) */
export type Band = "low" | "moderate" | "high" | "severe";
export function bandOf(stressScore: number): Band {
  if (stressScore <= 25) return "low";
  if (stressScore <= 50) return "moderate";
  if (stressScore <= 75) return "high";
  return "severe";
}

/** Validate a submission per spec (422 rules). Returns error string or null. */
export function validateAnswers(answers: unknown, freeText: unknown): string | null {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return "answers must be an object";
  }
  const a = answers as Record<string, unknown>;
  const items = [...DASS_ITEMS, ...CBI_P_ITEMS, ...CBI_W_ITEMS];
  const known = new Set(items.map((i) => i.id));
  for (const k of Object.keys(a)) {
    if (!known.has(k)) return `unknown item ${k}`;
  }
  for (const item of items) {
    const v = a[item.id];
    if (v === undefined || v === null) return `${item.id} is required`;
    if (typeof v !== "number") return `${item.id} must be numeric`;
    if (!SCALES[item.scale].some((o) => o.value === v)) {
      return `${item.id}: invalid value for its scale`;
    }
  }
  if (freeText !== undefined && freeText !== null) {
    if (typeof freeText !== "string") return "free_text must be a string";
    if (freeText.length > FREE_TEXT_ITEM.maxLength) return "free_text too long (max 1,000)";
  }
  return null;
}
