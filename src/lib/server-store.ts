import { promises as fs } from "fs";
import path from "path";

/**
 * Phase 3 storage: one JSON blob per user (keyed by Slack ID) on the server's
 * disk. Simple, dependency-free, works on any VPS/Docker host. Upgrade path:
 * swap these three functions for Prisma/Postgres without touching callers.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");

const safe = (key: string) => key.replace(/[^\w.-]+/g, "_");
const fileFor = (key: string) => path.join(DATA_DIR, `state-${safe(key)}.json`);

export async function loadBlob(key: string): Promise<string | null> {
  try {
    return await fs.readFile(fileFor(key), "utf-8");
  } catch {
    return null;
  }
}

export async function saveBlob(key: string, blob: string): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = fileFor(key) + ".tmp";
  await fs.writeFile(tmp, blob, "utf-8");
  await fs.rename(tmp, fileFor(key));
}

export async function deleteBlob(key: string): Promise<void> {
  try {
    await fs.unlink(fileFor(key));
  } catch {}
}
