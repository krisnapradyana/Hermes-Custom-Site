"use client";

import { FSDir } from "./local-fs";

/**
 * A compact "identity card" of a project folder — its structure (names,
 * sizes, layout), NOT file contents. The browser builds it by walking the
 * directory handle; it's stored server-side so the remote agent can reason
 * about the project even though it can't open the files directly.
 */

export interface ManifestEntry {
  p: string; // relative path
  d: boolean; // isDir
  s?: number; // size (files only)
}

export interface Manifest {
  generatedAt: string;
  root: string;
  entries: ManifestEntry[];
  fileCount: number;
  truncated: boolean;
}

export async function buildManifest(root: FSDir, maxEntries = 600, maxDepth = 5): Promise<Manifest> {
  const entries: ManifestEntry[] = [];
  let truncated = false;
  let fileCount = 0;

  async function walk(dir: FSDir, prefix: string, depth: number): Promise<void> {
    if (depth > maxDepth || truncated) return;
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith(".")) continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      const rel = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "file") {
        let s: number | undefined;
        try {
          s = (await handle.getFile()).size;
        } catch {}
        entries.push({ p: rel, d: false, s });
        fileCount++;
      } else {
        entries.push({ p: rel, d: true });
        await walk(handle, rel, depth + 1);
        if (truncated) return;
      }
    }
  }

  await walk(root, "", 0);
  return { generatedAt: new Date().toISOString(), root: root.name, entries, fileCount, truncated };
}

/** Stable signature to detect whether the folder changed since last upload. */
export function manifestSignature(m: Manifest): string {
  return m.entries.map((e) => `${e.p}:${e.s ?? "d"}`).join("|");
}
