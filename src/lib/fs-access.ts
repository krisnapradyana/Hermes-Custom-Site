import path from "path";
import { readProjects } from "./projects-store";

/**
 * Filesystem access control for the workspace panel.
 * Only folders registered on the user's projects (working/Drive folders)
 * may be listed or read — never arbitrary paths.
 */

const norm = (p: string) => path.resolve(p).toLowerCase();

/** The rclone Drive mount root on the server (everything lives under here). */
export const MOUNT_BASE = process.env.DRIVE_MOUNT_DIR ?? "/gdrive";

/** True if an absolute path is the mount base or inside it. */
export function isUnderMount(p: string): boolean {
  const n = norm(p);
  const base = norm(MOUNT_BASE);
  return n === base || n.startsWith(base + path.sep);
}

export async function getAllowedRoots(): Promise<string[]> {
  const projects = await readProjects();
  const roots: string[] = [];
  for (const p of projects) {
    if (p.workingFolder) roots.push(p.workingFolder);
    if (p.driveFolder) roots.push(p.driveFolder);
  }
  return roots;
}

export async function isAllowedRoot(_userKey: string, root: string): Promise<boolean> {
  // Any folder inside the Drive mount is browsable, plus explicitly
  // registered project folders (covers non-mount setups too).
  if (isUnderMount(root)) return true;
  const roots = await getAllowedRoots();
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
