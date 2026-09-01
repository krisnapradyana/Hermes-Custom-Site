import { promises as fs } from "fs";
import path from "path";

/**
 * Production Tracker mappings — one JSON per project describing how that
 * project's Google Sheet maps onto the canonical model (see
 * docs/PROD-TRACKER-PLAN.md). The sheet itself stays the source of truth;
 * this only stores HOW to read it.
 */

export type ColumnRole =
  | "shotId"
  | "scene"
  | "thumb"
  | "type"
  | "complexity"
  | "batch"
  | "remark"
  | "phaseStatus"
  | "phaseAssignee"
  | "phaseLink"
  | "ignore";

export type StatusBucket =
  | "todo"
  | "in_progress"
  | "waiting_client"
  | "revise"
  | "approved"
  | "unknown";

export interface TrackerColumn {
  index: number; // 0-based column index in the sheet
  header: string; // flattened header text at save time (validation anchor)
  role: ColumnRole;
  phase?: string; // for phase* roles
}

export interface ScheduleConfig {
  tab: string;
  monthRow: number; // 1-based row with month headers (AUG, SEPT…)
  weekRow: number; // 1-based row with week ranges (1-7, 8-14…)
}

export interface TrackerMapping {
  sheetId: string;
  sheetUrl: string;
  tab: string;
  headerRows: number; // data starts after this many rows
  columns: TrackerColumn[];
  /** lowercased raw status text → canonical bucket */
  statusDict: Record<string, StatusBucket>;
  /** Optional schedule-blocks tab (Weekly grid) rendered as a timeline. */
  schedule?: ScheduleConfig;
  /** Client share-link token; unset = no public page. */
  shareToken?: string;
  savedBy?: string;
  savedAt: string;
}

/** Reusable mapping template — matched against new sheets by header text. */
export interface TrackerTemplate {
  name: string;
  headerRows: number;
  columns: { header: string; role: ColumnRole; phase?: string }[];
  statusDict: Record<string, StatusBucket>;
  savedAt: string;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "trackers");
const file = (projectId: string) =>
  path.join(DIR, `${projectId.replace(/[^\w.-]+/g, "_")}.json`);

export async function readTrackerMapping(projectId: string): Promise<TrackerMapping | null> {
  try {
    return JSON.parse(await fs.readFile(file(projectId), "utf-8")) as TrackerMapping;
  } catch {
    return null;
  }
}

export async function saveTrackerMapping(
  projectId: string,
  mapping: TrackerMapping
): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const f = file(projectId);
  const tmp = `${f}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(mapping, null, 2), "utf-8");
  await fs.rename(tmp, f);
}

export async function deleteTrackerMapping(projectId: string): Promise<void> {
  await fs.rm(file(projectId), { force: true }).catch(() => {});
}

// ── Templates ────────────────────────────────────────────────────────────────

const TPL_DIR = path.join(DATA_DIR, "tracker-templates");
const tplFile = (name: string) =>
  path.join(TPL_DIR, `${name.replace(/[^\w.-]+/g, "_").slice(0, 60)}.json`);

export async function listTemplates(): Promise<TrackerTemplate[]> {
  try {
    const files = (await fs.readdir(TPL_DIR)).filter((f) => f.endsWith(".json"));
    const out: TrackerTemplate[] = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(await fs.readFile(path.join(TPL_DIR, f), "utf-8")));
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}

export async function saveTemplate(tpl: TrackerTemplate): Promise<void> {
  await fs.mkdir(TPL_DIR, { recursive: true });
  const f = tplFile(tpl.name);
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(tpl, null, 2), "utf-8");
  await fs.rename(tmp, f);
}

// ── Share tokens ─────────────────────────────────────────────────────────────

/** Find which project a share token belongs to (scan — tracker count is tiny). */
export async function findByShareToken(
  token: string
): Promise<{ projectId: string; mapping: TrackerMapping } | null> {
  if (!token || token.length < 24) return null;
  try {
    const files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        const mapping = JSON.parse(
          await fs.readFile(path.join(DIR, f), "utf-8")
        ) as TrackerMapping;
        if (mapping.shareToken === token) {
          return { projectId: f.replace(/\.json$/, ""), mapping };
        }
      } catch {}
    }
  } catch {}
  return null;
}

/** Extract the spreadsheet id from a pasted Google Sheets URL (or raw id). */
export function sheetIdFromUrl(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}
