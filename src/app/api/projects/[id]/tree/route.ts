import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireUser } from "@/lib/user-key";
import { readProjects } from "@/lib/projects-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recursive file list of a project's working folder, for "@file" mentions.
 * Cached briefly in memory because listing a Drive mount is slow.
 */

interface TreeFile {
  p: string; // path relative to the project folder (posix)
  d: boolean; // directory?
}

const cache = new Map<string, { at: number; files: TreeFile[] }>();
const TTL = 60_000;

async function walk(root: string, prefix: string, out: TreeFile[], depth: number): Promise<void> {
  if (depth > 6 || out.length > 3000) return;
  let entries;
  try {
    entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ p: rel, d: true });
      await walk(root, rel, out, depth + 1);
    } else if (e.isFile()) {
      out.push({ p: rel, d: false });
    }
    if (out.length > 3000) return;
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  const project = (await readProjects()).find((p) => p.id === id);
  const root = project?.workingFolder;
  if (!root) return NextResponse.json({ files: [], root: null });

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ files: hit.files, root });
  }

  const files: TreeFile[] = [];
  await walk(root, "", files, 0);
  cache.set(id, { at: Date.now(), files });
  return NextResponse.json({ files, root });
}
