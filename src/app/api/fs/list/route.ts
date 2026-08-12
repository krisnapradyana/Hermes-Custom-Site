import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireUser } from "@/lib/user-key";
import { isAllowedRoot, resolveSafe } from "@/lib/fs-access";
import { mapLimit, withDriveTimeout, isDriveTimeout } from "@/lib/fs-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Folder listing for the workspace panel. Two Drive-mount optimizations:
 *  - stats run in PARALLEL — sequential stats over a cold FUSE mount were
 *    the main reason one listing could take many seconds
 *  - a short shared cache absorbs the 8s polling from every open tab and
 *    every user on the same project, so the mount sees one listing per TTL
 */

interface Entry {
  name: string;
  isDir: boolean;
  size?: number;
  mtime?: string;
}

const TTL = 5_000;
const cache = new Map<string, { at: number; entries: Entry[] }>();

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;

  let body: { root?: string; sub?: string; fresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const root = (body.root ?? "").trim();
  if (!root || !(await isAllowedRoot(key, root))) {
    return NextResponse.json({ error: "Folder is not registered on any project" }, { status: 403 });
  }
  const full = resolveSafe(root, body.sub ?? "");
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  // fresh=true (the manual Refresh button) skips the cache read but still
  // refills it, so everyone else benefits from the forced listing.
  const hit = body.fresh ? undefined : cache.get(full);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ entries: hit.entries });
  }

  try {
    // Concurrency-capped (a cold listing must never hog the whole libuv
    // threadpool) and time-boxed (a dead mount answers 503, not a hang).
    const entries = await withDriveTimeout(
      (async () => {
        const dirents = await fs.readdir(full, { withFileTypes: true });
        const visible = dirents.slice(0, 500).filter((d) => !d.name.startsWith("."));
        return mapLimit(visible, 8, async (d): Promise<Entry> => {
          let size: number | undefined;
          let mtime: string | undefined;
          try {
            const st = await fs.stat(path.join(full, d.name));
            size = st.isFile() ? st.size : undefined;
            mtime = st.mtime.toISOString();
          } catch {}
          return { name: d.name, isDir: d.isDirectory(), size, mtime };
        });
      })()
    );
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));

    if (cache.size > 300) cache.clear(); // crude but sufficient bound
    cache.set(full, { at: Date.now(), entries });
    return NextResponse.json({ entries });
  } catch (err) {
    if (isDriveTimeout(err)) {
      return NextResponse.json(
        { error: "Drive is responding slowly — try again in a moment" },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Could not read folder" }, { status: 404 });
  }
}
