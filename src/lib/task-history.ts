import { promises as fs } from "fs";
import path from "path";
import { readProjects } from "./projects-store";
import { listArchived } from "./tasks-store";
import { withLock } from "./mutex";

/**
 * TASK-HISTORY.md — the project's completed-work documentation, regenerated
 * from the task archive whenever the sweep moves something. Lives in the
 * project's working folder on the shared Drive, so the team AND the agent
 * can read it ("what did we deliver in September?"). Same philosophy as
 * PROJECT-TRACKER.md: the app owns the data, the Drive carries the story.
 */

const monthLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export async function updateTaskHistory(projectId: string): Promise<void> {
  await withLock(`task-history-${projectId}`, async () => {
    try {
      const project = (await readProjects()).find((p) => p.id === projectId);
      if (!project?.workingFolder) return; // nowhere to write
      const archived = await listArchived(projectId);
      if (archived.length === 0) return;

      const lines: string[] = [
        `# Task History — ${project.name}`,
        "",
        "Auto-generated from completed tasks (archived 14 days after being done).",
        "Do not edit — this file is rewritten by the assistant web app.",
        `Last updated: ${new Date().toISOString()}. Completed tasks: ${archived.length}.`,
        "",
      ];

      // Group by completion month (updatedAt = when the task became done).
      const byMonth = new Map<string, typeof archived>();
      for (const t of archived) {
        const key = t.updatedAt.slice(0, 7);
        byMonth.set(key, [...(byMonth.get(key) ?? []), t]);
      }
      for (const [key, tasks] of [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
        lines.push(`## ${monthLabel(`${key}-01T00:00:00`)}`, "");
        for (const t of tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
          lines.push(
            `- **${t.title}**${t.phase ? ` (${t.phase})` : ""} — ` +
              `${t.assignee?.name ?? "unassigned"}, done ${t.updatedAt.slice(0, 10)}` +
              `${t.dueDate ? `, was due ${t.dueDate}` : ""}`
          );
          if (t.note) lines.push(`  - Brief: ${t.note.replace(/\s+/g, " ").slice(0, 300)}`);
          if (t.statusNote)
            lines.push(`  - Last feedback: ${t.statusNote.replace(/\s+/g, " ").slice(0, 300)}`);
        }
        lines.push("");
      }

      const target = path.posix.join(project.workingFolder, "TASK-HISTORY.md");
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, lines.join("\n"), "utf-8");
      await fs.rename(tmp, target);
    } catch (err) {
      console.warn(
        `[task-history] update failed for ${projectId}: ${
          err instanceof Error ? err.message : "unknown"
        }`
      );
    }
  });
}

/** Debounced per project — sweeps can move several tasks at once. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleTaskHistoryUpdate(projectId: string, delayMs = 3000): void {
  clearTimeout(timers.get(projectId));
  timers.set(
    projectId,
    setTimeout(() => {
      timers.delete(projectId);
      updateTaskHistory(projectId);
    }, delayMs)
  );
}
