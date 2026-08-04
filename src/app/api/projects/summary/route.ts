import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireUser } from "@/lib/user-key";
import { readProjects } from "@/lib/projects-store";
import { listByProject } from "@/lib/conversations-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One aggregated call for the Projects listing: per project, the shared
 * conversation count, the latest conversation, last-activity time, an
 * "active now" flag, and a few recent images from the working folder
 * for the card thumbnail strip.
 */

const ACTIVE_WINDOW_MS = 2 * 60 * 1000; // "active now" = updated in last 2 min
const SCAN_MAX_DEPTH = 3; // don't descend forever into a big Drive tree
const SCAN_MAX_ENTRIES = 500; // hard cap on directory entries visited
const SCAN_CACHE_MS = 30_000;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

interface Thumb {
  sub: string; // path relative to the working folder
  mtimeMs: number; // cache-buster for /api/thumb
}

interface ProjectSummary {
  id: string;
  conversationCount: number;
  latest: { id: string; title: string; updatedAt: string; by?: string } | null;
  lastActivityAt: string;
  activeNow: boolean;
  thumbs: Thumb[];
}

/** Newest images in a folder, bounded scan. Cached briefly per folder. */
const scanCache = new Map<string, { at: number; thumbs: Thumb[] }>();

async function recentImages(root: string): Promise<Thumb[]> {
  const hit = scanCache.get(root);
  if (hit && Date.now() - hit.at < SCAN_CACHE_MS) return hit.thumbs;

  const found: { sub: string; mtimeMs: number }[] = [];
  let visited = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > SCAN_MAX_DEPTH || visited >= SCAN_MAX_ENTRIES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (visited++ >= SCAN_MAX_ENTRIES) return;
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) {
        try {
          const st = await fs.stat(full);
          found.push({ sub: path.relative(root, full), mtimeMs: st.mtimeMs });
        } catch {}
      }
    }
  }

  await walk(root, 0);
  const thumbs = found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 4);
  scanCache.set(root, { at: Date.now(), thumbs });
  return thumbs;
}

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const projects = await readProjects();
  const now = Date.now();

  const summaries: ProjectSummary[] = await Promise.all(
    projects.map(async (p) => {
      const convs = await listByProject(p.id); // already sorted newest-first
      const latest = convs[0] ?? null;
      const lastActivityAt =
        latest && latest.updatedAt > p.createdAt ? latest.updatedAt : p.createdAt;
      const activeNow = !!latest && now - Date.parse(latest.updatedAt) < ACTIVE_WINDOW_MS;
      const thumbs = p.workingFolder ? await recentImages(p.workingFolder) : [];
      return {
        id: p.id,
        conversationCount: convs.length,
        latest: latest
          ? {
              id: latest.id,
              title: latest.title,
              updatedAt: latest.updatedAt,
              by: latest.createdBy?.name,
            }
          : null,
        lastActivityAt,
        activeNow,
        thumbs,
      };
    })
  );

  return NextResponse.json({ summaries });
}
