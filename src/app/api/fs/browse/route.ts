import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getUserKey } from "@/lib/user-key";
import { MOUNT_BASE, resolveSafe } from "@/lib/fs-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Directory browser for the project folder picker. Lists sub-folders under
 * the Drive mount base so users can navigate the real shared Drive tree and
 * choose a working folder. Folders only; traversal-locked to the mount.
 */
export async function GET(req: NextRequest) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const sub = req.nextUrl.searchParams.get("sub") ?? "";
  const full = resolveSafe(MOUNT_BASE, sub);
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const dirents = await fs.readdir(full, { withFileTypes: true });
    const names = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 1000);

    // Modification times so the picker can sort by date. Client re-sorts.
    const folders = await Promise.all(
      names.map(async (name) => {
        try {
          const st = await fs.stat(path.join(full, name));
          return { name, mtime: st.mtime.toISOString() };
        } catch {
          return { name, mtime: undefined };
        }
      })
    );

    // Prefetch: warm the rclone dir-cache for these sub-folders in the
    // background so the user's NEXT click is instant. Fire-and-forget,
    // capped so a huge folder doesn't flood the Drive API.
    for (const name of names.slice(0, 30)) {
      fs.readdir(path.join(full, name)).catch(() => {});
    }

    return NextResponse.json({ base: MOUNT_BASE, path: full, sub, folders });
  } catch {
    return NextResponse.json({ error: "Could not read folder" }, { status: 404 });
  }
}
