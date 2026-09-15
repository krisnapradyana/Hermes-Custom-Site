import { NextRequest, NextResponse } from "next/server";
import { createTask, Person } from "@/lib/tasks-store";
import { readProjects } from "@/lib/projects-store";
import { readMembers } from "@/lib/members-store";
import { notifyTaskAssigned } from "@/lib/slack-notify";
import { scheduleTeamStatusUpdate } from "@/lib/team-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-to-server task creation — the door that lets Hermes turn
 * "add a task called X for Krisna, due Friday" into a board entry.
 *
 * Same INTERNAL_TOKEN convention as the other /api/internal routes.
 * Create-only by design: no edit, no delete — a chat typo can add a stray
 * task but never destroy work. Tasks land through the same store the UI
 * uses, so DM notifications and TEAM-STATUS refresh come for free.
 *
 * POST body:
 *   project    — project id OR name (case-insensitive; must match exactly one)
 *   title      — required
 *   assignee   — optional: Slack id (U…) or a name resolved via the member
 *                directory (their record must have a Slack account linked)
 *   dueDate    — optional, YYYY-MM-DD
 *   startDate  — optional, YYYY-MM-DD
 *   phase      — optional, e.g. "Animation"
 *   note       — optional description
 */

const HERMES: Person = { key: "hermes", name: "Hermes" };

export async function POST(req: NextRequest) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    project?: string;
    title?: string;
    assignee?: string;
    dueDate?: string;
    startDate?: string;
    phase?: string;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const projectQuery = body.project?.trim();
  if (!projectQuery) {
    return NextResponse.json(
      { error: "project required (id or name — GET /api/internal/projects lists them)" },
      { status: 400 }
    );
  }

  // --- Resolve the project: exact id, exact name, then unique substring. ---
  const projects = (await readProjects()).filter((p) => !p.archived);
  const q = projectQuery.toLowerCase();
  let project =
    projects.find((p) => p.id === projectQuery) ??
    projects.find((p) => p.name.toLowerCase() === q);
  if (!project) {
    const partial = projects.filter((p) => p.name.toLowerCase().includes(q));
    if (partial.length === 1) project = partial[0];
    else if (partial.length > 1) {
      return NextResponse.json(
        { error: `"${projectQuery}" matches several projects: ${partial.map((p) => p.name).join(", ")} — be more specific` },
        { status: 400 }
      );
    }
  }
  if (!project) {
    return NextResponse.json(
      { error: `No project matches "${projectQuery}". GET /api/internal/projects lists them.` },
      { status: 404 }
    );
  }

  // --- Resolve the assignee (optional): Slack id, or directory name. ---
  let assignee: Person | undefined;
  const rawAssignee = body.assignee?.trim();
  if (rawAssignee) {
    if (/^[UW][A-Z0-9]{6,}$/.test(rawAssignee)) {
      const member = (await readMembers()).find((m) => m.slackId === rawAssignee);
      assignee = { key: rawAssignee, name: member?.name ?? rawAssignee };
    } else {
      const members = await readMembers();
      const aq = rawAssignee.toLowerCase();
      let member =
        members.find((m) => m.name.toLowerCase() === aq) ??
        undefined;
      if (!member) {
        const partial = members.filter((m) => m.name.toLowerCase().includes(aq));
        if (partial.length === 1) member = partial[0];
        else if (partial.length > 1) {
          return NextResponse.json(
            { error: `"${rawAssignee}" matches several members: ${partial.map((m) => m.name).join(", ")}` },
            { status: 400 }
          );
        }
      }
      if (!member) {
        return NextResponse.json(
          { error: `No member named "${rawAssignee}" in the directory` },
          { status: 404 }
        );
      }
      if (!member.slackId) {
        return NextResponse.json(
          { error: `${member.name} has no Slack account linked in the member directory yet — link it there first, or pass their Slack id directly` },
          { status: 409 }
        );
      }
      assignee = { key: member.slackId, name: member.name };
    }
  }

  const task = await createTask(project.id, HERMES, {
    title,
    note: body.note,
    phase: body.phase,
    assignee,
    startDate: body.startDate,
    dueDate: body.dueDate,
  });

  if (task.assignee) {
    notifyTaskAssigned({
      assigneeSlackId: task.assignee.key,
      assigneeName: task.assignee.name,
      taskTitle: task.title,
      phase: task.phase,
      dueDate: task.dueDate,
      projectId: project.id,
      projectName: project.name,
      byName: "Hermes",
    });
  }

  scheduleTeamStatusUpdate();
  return NextResponse.json(
    {
      task,
      summary: `Created "${task.title}" in ${project.name}${
        task.assignee ? `, assigned to ${task.assignee.name}` : ""
      }${task.dueDate ? `, due ${task.dueDate}` : ""}`,
    },
    { status: 201 }
  );
}
