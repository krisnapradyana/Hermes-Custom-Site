import { promises as fs } from "fs";
import path from "path";

/**
 * The agent's server-side output area. Each project gets
 * {AGENT_WORKSPACE_DIR}/projects/<id>; the Hermes container mounts the same
 * volume, so files the agent writes there are visible to the web app, which
 * delivers them to users' browsers (and on into their local Drive folder).
 */

const BASE = process.env.AGENT_WORKSPACE_DIR ?? "/workspace";

const safeId = (id: string) => id.replace(/[^\w.-]+/g, "_");

export function projectWorkspaceDir(projectId: string): string {
  return path.join(BASE, "projects", safeId(projectId));
}

/** Path the AGENT should be told about (POSIX style, inside the containers). */
export function projectWorkspaceAgentPath(projectId: string): string {
  return `${BASE.replace(/\\/g, "/")}/projects/${safeId(projectId)}`.replace(/\/+/g, "/");
}

export interface WorkspaceFile {
  p: string; // relative path (posix separators)
  s: number; // size
  m: number; // mtime (ms)
}

export async function listWorkspaceFiles(projectId: string, max = 500): Promise<WorkspaceFile[]> {
  const root = projectWorkspaceDir(projectId);
  const out: WorkspaceFile[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, rel);
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(full);
          out.push({ p: rel, s: st.size, m: Math.floor(st.mtimeMs) });
        } catch {}
      }
    }
  }

  await walk(root, "");
  return out;
}

/** Resolve a relative file path inside the project workspace, blocking traversal. */
export function resolveWorkspaceFile(projectId: string, sub: string): string | null {
  const root = projectWorkspaceDir(projectId);
  const resolved = path.resolve(root, sub);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}
