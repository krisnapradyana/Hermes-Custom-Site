import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireUser } from "@/lib/user-key";
import { MOUNT_BASE, resolveSafe } from "@/lib/fs-access";
import { mapLimit, withDriveTimeout, isDriveTimeout } from "@/lib/fs-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Directory browser for the project folder picker. Lists sub-folders under
 * the Drive mount base so users can navigate the real shared Drive tree and
 * choose a working folder. Folders only; traversal-locked to the mount.
 * Concurrency-capped + time-boxed — see lib/fs-limit.
 */
export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const sub = req.nextUrl.searchParams.get("sub") ?? "";
  const full = resolveSafe(MOUNT_BASE, sub);
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const folders = await withDriveTimeout(
      (async () => {
        const dirents = await fs.readdir(full, { withFileTypes: true });
        const names = dirents
          .filter((d) => d.isDirectory() && !d.name.startsWith("."))
          .map((d) => d.name)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, 1000);

        // Modification times so the picker can sort by date. Client re-sorts.
        return mapLimit(names, 8, async (name) => {
          try {
            const st = await fs.stat(path.join(full, name));
            return { name, mtime: st.mtime.toISOString() };
          } catch {
            return { name, mtime: undefined as string | undefined };
          }
        });
      })()
    );

    // Warm the dir-cache for the first few sub-folders in the background so
    // the user's next click is instant — but gently (2 at a time), so a cold
    // mount is never flooded.
    void mapLimit(
      folders.slice(0, 12).map((f) => f.name),
      2,
      (name) => fs.readdir(path.join(full, name)).then(() => undefined)
    ).catch(() => {});

    return NextResponse.json({ base: MOUNT_BASE, path: full, sub, folders });
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
