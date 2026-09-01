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

export interface TrackerMapping {
  sheetId: string;
  sheetUrl: string;
  tab: string;
  headerRows: number; // data starts after this many rows
  columns: TrackerColumn[];
  /** lowercased raw status text → canonical bucket */
  statusDict: Record<string, StatusBucket>;
  savedBy?: string;
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

/** Extract the spreadsheet id from a pasted Google Sheets URL (or raw id). */
export function sheetIdFromUrl(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim())) return url.trim();
  return null;
}
