import { promises as fs } from "fs";
import path from "path";
import { Project } from "./types";
import { withLock } from "./mutex";

/**
 * SHARED projects store — one file for the whole company, not per-user.
 * This is what makes projects visible across all members. (Chats and
 * artifacts stay per-user in server-store.ts.)
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "projects.json");

export async function readProjects(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeProjects(list: Project[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), "utf-8");
  await fs.rename(tmp, FILE);
}

/**
 * Serialized read-modify-write. ALWAYS use this (never readProjects +
 * writeProjects back-to-back) when mutating — concurrent mutations
 * otherwise silently lose one side's changes.
 * Return the new list to persist it, or null to abort without writing.
 */
export async function updateProjects(
  mutate: (list: Project[]) => Project[] | null | Promise<Project[] | null>
): Promise<Project[] | null> {
  return withLock("projects.json", async () => {
    const list = await readProjects();
    const next = await mutate(list);
    if (next) await writeProjects(next);
    return next;
  });
}

// --- Per-project folder manifest (structure the agent reads) ---
// Legacy: written by the old client-side File System Access flow (removed).
// /api/hermes still reads any manifest left on disk; new projects simply
// have none. Full removal happens with the context-injection rework.

const safeId = (id: string) => id.replace(/[^\w.-]+/g, "_");
const manifestFile = (id: string) => path.join(DATA_DIR, `manifest-${safeId(id)}.json`);

export async function readManifest(id: string): Promise<string | null> {
  try {
    return await fs.readFile(manifestFile(id), "utf-8");
  } catch {
    return null;
  }
}
