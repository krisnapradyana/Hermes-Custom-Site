import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { readProjects } from "@/lib/projects-store";
import { listTasks, listArchived, Task } from "@/lib/tasks-store";
import { listByProject } from "@/lib/conversations-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Builds the "Summarize project" prompt: a verified fact pack (project meta,
 * milestones, tasks, archive, clock hours, conversation titles) plus strict
 * documentation instructions. The button opens a new project conversation
 * with this prompt, so the agent works transparently and the finished
 * document lands in the project folder via the normal file-safety rules.
 */

interface ClockMember {
  name: string;
  todayMs: number;
  weekMs: number;
  totalMs?: number;
  sessions: number;
  lastSeen: string;
}

const fmtH = (ms: number) => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const taskLine = (t: Task) =>
  `- [${t.status}] ${t.title}${t.phase ? ` (${t.phase})` : ""}` +
  `${t.assignee ? ` — ${t.assignee.name}` : " — unassigned"}` +
  `${t.dueDate ? `, due ${t.dueDate}` : ""}` +
  `${t.statusNote ? ` · last feedback: "${t.statusNote.slice(0, 120)}"` : ""}`;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;

  const project = (await readProjects()).find((p) => p.id === id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tasks = await listTasks(id);
  const archived = await listArchived(id);
  const conversations = await listByProject(id);

  // All-time clock hours from the attendee app (optional — skip if down).
  let clock: ClockMember[] = [];
  const token = process.env.INTERNAL_TOKEN;
  if (token) {
    try {
      const base = (process.env.TIMECLOCK_URL ?? "http://attendee-ui:3000").replace(/\/$/, "");
      const res = await fetch(`${base}/api/timeclock/${encodeURIComponent(id)}`, {
        headers: { "x-internal-token": token },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) clock = ((await res.json()) as { members: ClockMember[] }).members;
    } catch {}
  }

  const today = new Date().toISOString().slice(0, 10);
  const milestones = tasks.filter((t) => t.kind === "milestone");
  const open = tasks.filter((t) => t.kind !== "milestone" && t.status !== "done");
  const doneRecent = tasks.filter((t) => t.kind !== "milestone" && t.status === "done");
  const completed = [...doneRecent, ...archived].slice(0, 40);
  const completedMore = doneRecent.length + archived.length - completed.length;
  const folder = project.workingFolder ?? "(no working folder)";
  const docName = `${project.name} — Summary ${today}`;

  const prompt = [
    `Write OFFICIAL COMPANY DOCUMENTATION for SuperPixel: a project summary of "${project.name}".`,
    ``,
    `=== VERIFIED PROJECT DATA (authoritative — use exactly as given) ===`,
    `Project: ${project.name}`,
    `Description: ${project.description || "(none)"}`,
    `Schedule: ${project.startDate ?? "not set"} → ${project.deadline ?? "not set"} (today: ${today})`,
    `Working folder: ${folder}`,
    ``,
    `Milestones (${milestones.length}):`,
    ...(milestones.length
      ? milestones.map(
          (m) => `- ${m.title} — ${m.dueDate ?? "no date"} — ${m.status === "done" ? "DONE" : "pending"}`
        )
      : ["- none recorded"]),
    ``,
    `Open tasks (${open.length}):`,
    ...(open.length ? open.map(taskLine) : ["- none"]),
    ``,
    `Completed tasks (${completed.length}${completedMore > 0 ? ` shown, ${completedMore} more in TASK-HISTORY.md` : ""}):`,
    ...(completed.length
      ? completed.map(
          (t) =>
            `- ${t.title}${t.phase ? ` (${t.phase})` : ""} — ${t.assignee?.name ?? "unassigned"}, done ${t.updatedAt.slice(0, 10)}`
        )
      : ["- none yet"]),
    ``,
    `Hours worked on this project (from the time clock):`,
    ...(clock.length
      ? clock.map(
          (m) =>
            `- ${m.name}: ${fmtH(m.totalMs ?? m.weekMs)} total across ${m.sessions} sessions, last active ${m.lastSeen.slice(0, 10)}`
        )
      : ["- no clock data available"]),
    ``,
    `Team conversations in this project (titles): ${
      conversations.length ? conversations.slice(0, 15).map((c) => `"${c.title}"`).join(", ") : "none"
    }`,
    ``,
    `=== INSTRUCTIONS ===`,
    `1. Before writing, read the working folder for context: the "Project Brief" and "From Client" subfolders, TASK-HISTORY.md, and any brief/README documents. Use ONLY facts from the data above and from files you actually opened. Anything unknown: write "Not documented". NEVER invent client names, dates, feedback, or outcomes.`,
    `2. Write in professional English with EXACTLY these sections:`,
    `   ${project.name} — Project Summary  (title; subtitle: Generated ${today} · SuperPixel)`,
    `   1. Overview — 3-5 sentences: what the project is, for whom, and its current state.`,
    `   2. Client & brief — from the brief documents.`,
    `   3. Schedule & milestones — dates, each milestone with status, on-track or overdue assessment.`,
    `   4. Team & effort — who worked on it, their hours, the phases they covered.`,
    `   5. Work history & iterations — completed work by phase, notable revision cycles and what the feedback was.`,
    `   6. Current status & risks — open work, overdue items, blockers.`,
    `   7. Next steps — concrete, derived from the open tasks and pending milestones.`,
    `3. Save it as a Word document: "${folder}/${docName}.docx" — build the .docx with your tools (e.g. python-docx in the terminal; install it if needed). Use proper heading styles, not plain text. ONLY if producing .docx is truly impossible, save "${folder}/${docName}.md" instead and say so explicitly.`,
    `4. This must be a NEW file — if the name already exists, append " v2" (never overwrite anything).`,
    `5. End your reply with the full absolute path of the saved file on its own line.`,
  ].join("\n");

  return NextResponse.json({ prompt, title: `Project summary — ${today}` });
}
