import path from "path";
import { loadBlob } from "./server-store";

/**
 * Filesystem access control for the workspace panel.
 * Only folders registered on the user's projects (working/Drive folders)
 * may be listed or read — never arbitrary paths.
 */

const norm = (p: string) => path.resolve(p).toLowerCase();

export async function getAllowedRoots(userKey: string): Promise<string[]> {
  const blob = await loadBlob(userKey);
  if (!blob) return [];
  try {
    const parsed = JSON.parse(blob) as {
      state?: { projects?: { workingFolder?: string; driveFolder?: string }[] };
    };
    const roots: string[] = [];
    for (const p of parsed.state?.projects ?? []) {
      if (p.workingFolder) roots.push(p.workingFolder);
      if (p.driveFolder) roots.push(p.driveFolder);
    }
    return roots;
  } catch {
    return [];
  }
}

export async function isAllowedRoot(userKey: string, root: string): Promise<boolean> {
  const roots = await getAllowedRoots(userKey);
  return roots.some((r) => norm(r) === norm(root));
}

/** Resolve root+sub and reject path traversal outside the root. */
export function resolveSafe(root: string, sub: string): string | null {
  const resolved = path.resolve(root, sub || ".");
  const normRoot = path.resolve(root);
  if (
    resolved.toLowerCase() !== normRoot.toLowerCase() &&
    !resolved.toLowerCase().startsWith(normRoot.toLowerCase() + path.sep)
  ) {
    return null;
  }
  return resolved;
}
