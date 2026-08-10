import { promises as fs } from "fs";
import path from "path";
import { Project } from "./types";
import { readProjects } from "./projects-store";
import { listByProject } from "./conversations-store";
import { withLock } from "./mutex";

/**
 * PROJECT TRACKER — the agent's long-term project index.
 *
 * Hermes' persistent memory is tiny by design (a few KB injected into every
 * API call), so it cannot hold hundreds of projects. Instead, the web app —
 * which already owns the authoritative project list — writes a markdown
 * digest to the shared Drive whenever projects change. The agent's context
 * tells it to READ this file when asked about past or other projects: zero
 * tokens until actually needed, always current, no human maintenance.
 *
 * Location: TRACKER_PATH env, default /gdrive/SUPERPIXEL/PROJECT-TRACKER.md
 * (must be under the Drive mount so both containers and the team see it).
 */

const TRACKER_PATH =
  process.env.TRACKER_PATH ??
  path.posix.join(process.env.DRIVE_MOUNT_DIR ?? "/gdrive", "SUPERPIXEL", "PROJECT-TRACKER.md");

export function trackerPath(): string {
  return TRACKER_PATH;
}

const fmtDate = (iso?: string) => (iso ? iso.slice(0, 10) : "unknown");

/**
 * Everything from this heading onward is PRESERVED verbatim across
 * regenerations — it's the manually/agent-curated archive of pre-web
 * projects. Only the web-projects section above it is rewritten.
 */
const ARCHIVE_MARKER = "# Past Projects Archive";

export async function renderTracker(
  projects: Project[],
  activity: Map<string, { count: number; lastAt?: string; lastTitle?: string }>
): Promise<string> {
  const sorted = [...projects].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const lines: string[] = [
    "# SuperPixel Project Tracker",
    "",
    "The web-projects section below is auto-generated — do not edit it by hand.",
    "The Past Projects Archive section at the end is preserved across updates.",
    `Last updated: ${new Date().toISOString()}. Web projects: ${projects.length}.`,
    "",
    "## How to answer project questions (agent instructions)",
    "",
    "1. LOOKUP — user names a project (current or legacy, any year): find its",
    "   entry here, then EXPLORE ITS FOLDER before answering. Web projects list",
    "   their working folder; archive projects live under",
    "   /gdrive/SUPERPIXEL/{YEAR} PROJECTS/{id - name}/ — list the folder,",
    "   read any brief/README/deliverables, and explain the project concretely",
    "   (client, deliverable type, techniques, folder structure) so the user",
    "   can use it as a reference.",
    "2. SIMILARITY — user asks for references similar to current work: scan the",
    "   descriptions in BOTH sections, pick the 2-4 closest matches (client,",
    "   deliverable type, style, industry), and present them with their folder",
    "   paths and one line on why each is relevant. Offer to dig into one.",
    "3. Never store this list in persistent memory; read this file on demand.",
    "",
    "---",
    "",
  ];

  for (const p of sorted) {
    const act = activity.get(p.id);
    lines.push(`## ${p.name}`);
    lines.push("");
    if (p.description) lines.push(`${p.description}`);
    lines.push(`- Working folder: ${p.workingFolder ?? "(none)"}`);
    lines.push(`- Created: ${fmtDate(p.createdAt)} by ${p.createdBy?.name ?? "unknown"}`);
    if (act && act.count > 0) {
      lines.push(
        `- Conversations: ${act.count} (last activity ${fmtDate(act.lastAt)}${
          act.lastTitle ? ` — "${act.lastTitle}"` : ""
        })`
      );
    } else {
      lines.push(`- Conversations: none yet`);
    }
    lines.push("");
  }

  if (sorted.length === 0) {
    lines.push("_No projects yet._", "");
  }

  return lines.join("\n");
}

/**
 * Regenerate the tracker from current state. Debounced by callers via
 * scheduleTrackerUpdate(); serialized so concurrent writes can't interleave.
 * Failures are logged but never break the mutation that triggered them —
 * e.g. when the Drive mount is briefly unavailable, the next change (or
 * boot) rewrites it.
 */
export async function updateTracker(): Promise<void> {
  await withLock("project-tracker", async () => {
    try {
      const projects = await readProjects();
      const activity = new Map<string, { count: number; lastAt?: string; lastTitle?: string }>();
      for (const p of projects) {
        const convs = await listByProject(p.id); // newest-first
        activity.set(p.id, {
          count: convs.length,
          lastAt: convs[0]?.updatedAt,
          lastTitle: convs[0]?.title,
        });
      }

      let body = await renderTracker(projects, activity);

      // Preserve the curated Past Projects Archive from the existing file —
      // it is written once by the agent (505+ legacy entries) and must
      // survive every regeneration of the web-projects section above it.
      try {
        const existing = await fs.readFile(TRACKER_PATH, "utf-8");
        const idx = existing.indexOf(`\n${ARCHIVE_MARKER}`);
        if (idx >= 0) {
          body = body.trimEnd() + "\n\n---\n" + existing.slice(idx);
        }
      } catch {
        // no existing file — nothing to preserve
      }

      await fs.mkdir(path.dirname(TRACKER_PATH), { recursive: true });
      const tmp = `${TRACKER_PATH}.${process.pid}.tmp`;
      await fs.writeFile(tmp, body, "utf-8");
      await fs.rename(tmp, TRACKER_PATH);
    } catch (err) {
      console.warn(
        `[tracker] update failed (will retry on next change): ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
    }
  });
}

/** Debounce: project edits often come in bursts; one write 3s later covers all. */
let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleTrackerUpdate(delayMs = 3000): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    updateTracker();
  }, delayMs);
}
