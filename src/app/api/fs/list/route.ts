import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireUser } from "@/lib/user-key";
import { isAllowedRoot, resolveSafe } from "@/lib/fs-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;

  let body: { root?: string; sub?: string };
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

  try {
    const dirents = await fs.readdir(full, { withFileTypes: true });
    const entries = [];
    for (const d of dirents.slice(0, 500)) {
      if (d.name.startsWith(".")) continue;
      let size: number | undefined;
      let mtime: string | undefined;
      try {
        const st = await fs.stat(path.join(full, d.name));
        size = st.isFile() ? st.size : undefined;
        mtime = st.mtime.toISOString();
      } catch {}
      entries.push({ name: d.name, isDir: d.isDirectory(), size, mtime });
    }
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ error: "Could not read folder" }, { status: 404 });
  }
}
