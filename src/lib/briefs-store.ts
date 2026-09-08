import { promises as fs } from "fs";
import path from "path";

/**
 * Brief Generator (Tools) — stored results. A brief is generated ONCE from an
 * uploaded client document and kept as markdown; it lives standalone under
 * Tools and can optionally be attached to a project afterwards.
 */

export interface BriefRecord {
  id: string;
  status: "generating" | "ready" | "error";
  error?: string;
  /** Display title — model-provided once ready, else the source filename. */
  title: string;
  sourceFile: string;
  projectId?: string;
  contact?: string;
  notes?: string;
  markdown?: string;
  createdBy: string;
  createdAt: string;
  finishedAt?: string;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "briefs");

const fileOf = (id: string) => path.join(DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);

export async function saveBrief(rec: BriefRecord): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${fileOf(rec.id)}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(rec, null, 2));
  await fs.rename(tmp, fileOf(rec.id));
}

export async function readBrief(id: string): Promise<BriefRecord | null> {
  try {
    return JSON.parse(await fs.readFile(fileOf(id), "utf-8")) as BriefRecord;
  } catch {
    return null;
  }
}

export async function deleteBrief(id: string): Promise<void> {
  try {
    await fs.unlink(fileOf(id));
  } catch {}
}

/** Newest first, markdown stripped (list view stays light). */
export async function listBriefs(): Promise<Omit<BriefRecord, "markdown">[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Omit<BriefRecord, "markdown">[] = [];
  for (const f of files) {
    try {
      const rec = JSON.parse(await fs.readFile(path.join(DIR, f), "utf-8")) as BriefRecord;
      const { markdown: _m, ...rest } = rec;
      void _m;
      out.push(rest);
    } catch {}
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
