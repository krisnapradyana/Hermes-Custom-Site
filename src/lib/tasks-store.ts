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
  title: string;
  note?: string; // details / brief
  phase?: string; // e.g. Styleframes, Animation, Render, On-site
  assignee?: Person;
  status: TaskStatus;
  statusNote?: string; // e.g. revision feedback
  createdBy: Person;
  createdAt: string;
  updatedAt: string;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "tasks");
const LOCK = "tasks";

const file = (projectId: string) => path.join(DIR, `${projectId.replace(/[^\w.-]+/g, "_")}.json`);

async function read(projectId: string): Promise<Task[]> {
  try {
    return JSON.parse(await fs.readFile(file(projectId), "utf-8")) as Task[];
  } catch {
    return [];
  }
}

async function write(projectId: string, tasks: Task[]): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  const f = file(projectId);
  const tmp = `${f}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2), "utf-8");
  await fs.rename(tmp, f);
}

export function listTasks(projectId: string): Promise<Task[]> {
  return withLock(LOCK, async () => {
    const tasks = await read(projectId);
    // Open work first (by status order), then most recently touched.
    const order = (t: Task) => TASK_STATUSES.indexOf(t.status);
    return tasks.sort((a, b) => order(a) - order(b) || b.updatedAt.localeCompare(a.updatedAt));
  });
}

export function createTask(
  projectId: string,
  by: Person,
  data: { title: string; note?: string; phase?: string; assignee?: Person }
): Promise<Task> {
  return withLock(LOCK, async () => {
    const tasks = await read(projectId);
    const now = new Date().toISOString();
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      title: data.title.slice(0, 200),
      note: data.note?.slice(0, 2000) || undefined,
      phase: data.phase || undefined,
      assignee: data.assignee,
      status: "todo",
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

/** All OPEN tasks assigned to one person, across every project (clock app). */
export function tasksForAssignee(userKey: string): Promise<Task[]> {
  return withLock(LOCK, async () => {
    let files: string[] = [];
    try {
      files = (await fs.readdir(DIR)).filter((f) => f.endsWith(".json"));
    } catch {}
    const mine: Task[] = [];
    for (const f of files) {
      const projectId = f.replace(/\.json$/, "");
      const tasks = await read(projectId);
      for (const t of tasks) {
        if (t.assignee?.key === userKey && t.status !== "done") mine.push(t);
      }
    }
    const order = (t: Task) => TASK_STATUSES.indexOf(t.status);
    return mine.sort((a, b) => order(a) - order(b) || b.updatedAt.localeCompare(a.updatedAt));
  });
}
