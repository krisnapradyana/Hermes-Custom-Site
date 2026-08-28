import { promises as fs } from "fs";
import path from "path";
import { withLock } from "./mutex";

/**
 * Project tasks — the "assign work, iterate smoothly" layer on top of the
 * timeclock. One JSON file per project under DATA_DIR/tasks.
 *
 * Lifecycle mirrors how motion work actually iterates:
 *   todo → doing → review → revision → done
 * (review→revision carries a note, so feedback lives on the task instead of
 * a lost Slack thread.)
 *
 * Permissions (v1): anyone signed in can create; only the ASSIGNEE or the
 * CREATOR can change status or edit; either can delete.
 */

export type TaskStatus = "todo" | "doing" | "review" | "revision" | "done";

export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "review", "revision", "done"];

export interface Person {
  key: string; // Slack user id
  name: string;
}

export interface Task {
  id: string;
  projectId: string;
  /** "task" (bar on the timeline) or "milestone" (diamond at one date). */
  kind?: "task" | "milestone";
  title: string;
  note?: string; // description / brief
  phase?: string; // e.g. Styleframes, Animation, Render, On-site
  assignee?: Person;
  status: TaskStatus;
  statusNote?: string; // e.g. revision feedback
  startDate?: string; // YYYY-MM-DD — when work should begin
  dueDate?: string; // YYYY-MM-DD — the task's own deadline
  createdBy: Person;
  createdAt: string;
  updatedAt: string;
  /** Set when the task is swept into the project archive. */
  archivedAt?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = (v?: string) => (v && ISO_DATE.test(v) ? v : undefined);

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "tasks");
const LOCK = "tasks";

const sanitize = (projectId: string) => projectId.replace(/[^\w.-]+/g, "_");
const file = (projectId: string) => path.join(DIR, `${sanitize(projectId)}.json`);
const archiveFile = (projectId: string) => path.join(DIR, `${sanitize(projectId)}.archive.json`);

async function readFileTasks(f: string): Promise<Task[]> {
  try {
    return JSON.parse(await fs.readFile(f, "utf-8")) as Task[];
  } catch {
    return [];
  }
}
const read = (projectId: string) => readFileTasks(file(projectId));

async function writeFileTasks(f: string, tasks: Task[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = `${f}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2), "utf-8");
  await fs.rename(tmp, f);
}
const write = (projectId: string, tasks: Task[]) => writeFileTasks(file(projectId), tasks);

/**
 * ARCHIVE SWEEP — the board shows work in motion, not history.
 * Tasks that have been DONE for 14+ days move to <project>.archive.json:
 * off the board, still searchable, restorable, and documented in the
 * project's TASK-HISTORY.md. Milestones are exempt — a handful per project,
 * and they are the skeleton of the timeline for its whole life.
 * The clock starts at completion (updatedAt of the done transition), so
 * long-running tasks are never at risk.
 */
const ARCHIVE_AFTER_MS = 14 * 86_400_000;

async function sweepProject(projectId: string, tasks: Task[]): Promise<Task[]> {
  const cutoff = Date.now() - ARCHIVE_AFTER_MS;
  const move = tasks.filter(
    (t) => t.status === "done" && t.kind !== "milestone" && Date.parse(t.updatedAt) < cutoff
  );
  if (move.length === 0) return tasks;
  const keep = tasks.filter((t) => !move.includes(t));
  const now = new Date().toISOString();
  const archived = [...(await readFileTasks(archiveFile(projectId)))];
  for (const t of move) archived.push({ ...t, archivedAt: now });
  await writeFileTasks(archiveFile(projectId), archived);
  await write(projectId, keep);
  // Regenerate the project's TASK-HISTORY.md (dynamic import: no static cycle).
  import("./task-history").then((m) => m.scheduleTaskHistoryUpdate(projectId)).catch(() => {});
  return keep;
}

export function listTasks(projectId: string): Promise<Task[]> {
  return withLock(LOCK, async () => {
    const tasks = await sweepProject(projectId, await read(projectId));
    // Open work first (by status order), then most recently touched.
    const order = (t: Task) => TASK_STATUSES.indexOf(t.status);
    return tasks.sort((a, b) => order(a) - order(b) || b.updatedAt.localeCompare(a.updatedAt));
  });
}

/** Archived (swept) tasks, newest first. */
export function listArchived(projectId: string): Promise<Task[]> {
  return withLock(LOCK, async () => {
    const tasks = await readFileTasks(archiveFile(projectId));
    return tasks.sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""));
  });
}

/** Bring a swept task back onto the board (safety net — anyone signed in). */
export function restoreTask(projectId: string, taskId: string): Promise<Task | null> {
  return withLock(LOCK, async () => {
    const archived = await readFileTasks(archiveFile(projectId));
    const t = archived.find((x) => x.id === taskId);
    if (!t) return null;
    await writeFileTasks(
      archiveFile(projectId),
      archived.filter((x) => x.id !== taskId)
    );
    const tasks = await read(projectId);
    delete t.archivedAt;
    t.updatedAt = new Date().toISOString(); // restart the 14-day clock
    tasks.push(t);
    await write(projectId, tasks);
    import("./task-history").then((m) => m.scheduleTaskHistoryUpdate(projectId)).catch(() => {});
    return t;
  });
}

export function createTask(
  projectId: string,
  by: Person,
  data: {
    title: string;
    note?: string;
    phase?: string;
    assignee?: Person;
    startDate?: string;
    dueDate?: string;
    kind?: "task" | "milestone";
  }
): Promise<Task> {
  return withLock(LOCK, async () => {
    const tasks = await read(projectId);
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      kind: data.kind === "milestone" ? "milestone" : "task",
      title: data.title.slice(0, 200),
      note: data.note?.slice(0, 2000) || undefined,
      phase: data.phase || undefined,
      assignee: data.assignee,
      status: "todo",
      startDate: isoDate(data.startDate),
      dueDate: isoDate(data.dueDate),
      createdBy: by,
      createdAt: now,
      updatedAt: now,
    };
    tasks.push(task);
    await write(projectId, tasks);
    return task;
  });
}

const mayEdit = (t: Task, userKey: string) =>
  t.createdBy.key === userKey || t.assignee?.key === userKey;

export function updateTask(
  projectId: string,
  taskId: string,
  userKey: string,
  patch: {
    title?: string;
    note?: string;
    phase?: string;
    assignee?: Person | null;
    status?: TaskStatus;
    statusNote?: string;
    startDate?: string | null;
    dueDate?: string | null;
  }
): Promise<Task | { error: string; code: number }> {
  return withLock(LOCK, async () => {
    const tasks = await read(projectId);
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return { error: "Task not found", code: 404 };
    if (!mayEdit(t, userKey)) {
      return { error: "Only the assignee or the creator can change this task", code: 403 };
    }
    if (patch.status && !TASK_STATUSES.includes(patch.status)) {
      return { error: "Invalid status", code: 400 };
    }
    if (patch.title != null) t.title = patch.title.slice(0, 200);
    if (patch.note != null) t.note = patch.note.slice(0, 2000) || undefined;
    if (patch.phase != null) t.phase = patch.phase || undefined;
    if (patch.assignee !== undefined) t.assignee = patch.assignee ?? undefined;
    if (patch.status) t.status = patch.status;
    if (patch.statusNote != null) t.statusNote = patch.statusNote.slice(0, 1000) || undefined;
    if (patch.startDate !== undefined) t.startDate = isoDate(patch.startDate ?? undefined);
    if (patch.dueDate !== undefined) t.dueDate = isoDate(patch.dueDate ?? undefined);
    t.updatedAt = new Date().toISOString();
    await write(projectId, tasks);
    return t;
  });
}

export function deleteTask(
  projectId: string,
  taskId: string,
  userKey: string
): Promise<boolean | { error: string; code: number }> {
  return withLock(LOCK, async () => {
    const tasks = await read(projectId);
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return { error: "Task not found", code: 404 };
    if (!mayEdit(t, userKey)) {
      return { error: "Only the assignee or the creator can delete this task", code: 403 };
    }
    await write(
      projectId,
      tasks.filter((x) => x.id !== taskId)
    );
    return true;
  });
}

/**
 * All OPEN tasks assigned to one person, across every project (clock app +
 * Team page). Tasks whose project no longer exists are EXCLUDED — a deleted
 * project must never leak raw ids into anyone's task list.
 */
export function tasksForAssignee(userKey: string): Promise<Task[]> {
  return withLock(LOCK, async () => {
    // Live project ids — file names are sanitized, so compare sanitized.
    const { readProjects } = await import("./projects-store");
    const alive = new Set((await readProjects()).map((p) => sanitize(p.id)));

    let files: string[] = [];
    try {
      files = (await fs.readdir(DIR)).filter(
        (f) => f.endsWith(".json") && !f.endsWith(".archive.json")
      );
    } catch {}
    const mine: Task[] = [];
    for (const f of files) {
      const fileId = f.replace(/\.json$/, "");
      if (!alive.has(fileId)) continue; // orphan of a deleted project
      const tasks = await readFileTasks(path.join(DIR, f));
      for (const t of tasks) {
        if (t.assignee?.key === userKey && t.status !== "done") mine.push(t);
      }
    }
    const order = (t: Task) => TASK_STATUSES.indexOf(t.status);
    return mine.sort((a, b) => order(a) - order(b) || b.updatedAt.localeCompare(a.updatedAt));
  });
}

/** Remove a project's task files (board + archive) — called on project delete. */
export function purgeProjectTasks(projectId: string): Promise<void> {
  return withLock(LOCK, async () => {
    await fs.rm(file(projectId), { force: true }).catch(() => {});
    await fs.rm(archiveFile(projectId), { force: true }).catch(() => {});
  });
}
