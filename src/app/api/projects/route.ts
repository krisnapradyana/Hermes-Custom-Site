import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { auth } from "@/auth";
import { requireUser } from "@/lib/user-key";
import { readProjects, updateProjects } from "@/lib/projects-store";
import { isUnderMount } from "@/lib/fs-access";
import { scheduleTrackerUpdate } from "@/lib/tracker";
import { uid } from "@/lib/uid";
import { Project } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLORS = ["#2a73e1", "#6a9b7e", "#7d8bc4", "#c4a35a", "#a3719b"];

/**
 * Standard folder template for a BRAND NEW project — the studio's canonical
 * structure, created inside the chosen location. Matches the layout used on
 * every past project.
 */
const TEMPLATE_FOLDERS = [
  "Assets",
  "Audio",
  "Comments",
  "FINAL OUTPUT",
  "From Client",
  "INPUT",
  "Preview",
  "Project Brief",
  "REF",
  "Timeline",
  "Working file",
];

/** Filesystem-safe folder name; empty string = nothing valid left. */
const cleanFolderName = (raw: string) =>
  raw
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 120);

async function creator(): Promise<{ name: string; slackId?: string }> {
  try {
    const s = await auth();
    if (s?.user) return { name: s.user.name ?? "Someone", slackId: s.user.slackId };
  } catch {}
  return { name: "You" };
}

export async function GET() {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  return NextResponse.json({ projects: await readProjects() });
}

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  let body: Partial<Project> & { newFolder?: { parent?: string; name?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  // ── Brand-new project: create the folder + the standard template inside
  // the chosen location, and make it the working folder. All-or-nothing:
  // if the Drive write fails, no project is created.
  if (body.newFolder) {
    const parent = (body.newFolder.parent ?? "").trim();
    const folderName = cleanFolderName(body.newFolder.name ?? "");
    if (!folderName) {
      return NextResponse.json({ error: "Folder name is required" }, { status: 400 });
    }
    if (!parent || !isUnderMount(parent)) {
      return NextResponse.json(
        { error: "Location must be a folder inside the shared Drive" },
        { status: 400 }
      );
    }
    try {
      const st = await fs.stat(parent);
      if (!st.isDirectory()) throw new Error("not a directory");
    } catch {
      return NextResponse.json({ error: "That location does not exist on the Drive" }, { status: 400 });
    }
    const target = path.join(parent, folderName);
    try {
      await fs.stat(target);
      return NextResponse.json(
        { error: `"${folderName}" already exists in that location — pick another name or use Existing project mode` },
        { status: 409 }
      );
    } catch {
      // does not exist — good
    }
    try {
      await fs.mkdir(target);
      for (const f of TEMPLATE_FOLDERS) await fs.mkdir(path.join(target, f));
    } catch (err) {
      return NextResponse.json(
        { error: `Could not create the project folders on the Drive: ${err instanceof Error ? err.message : "unknown error"}` },
        { status: 502 }
      );
    }
    body.workingFolder = target;
  }

  // Schedule fields: plain ISO dates or nothing.
  const isoDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

  const by = await creator();
  let project: Project | null = null;
  await updateProjects((list) => {
    project = {
      id: uid("proj"),
      name: body.name!.trim(),
      description: body.description?.trim() ?? "",
      color: COLORS[list.length % COLORS.length],
      createdAt: new Date().toISOString(),
      workingFolder: body.workingFolder?.trim() || undefined,
      driveFolder: body.driveFolder?.trim() || undefined,
      startDate: isoDate(body.startDate),
      deadline: isoDate(body.deadline),
      createdBy: by,
    };
    return [...list, project];
  });
  scheduleTrackerUpdate();
  return NextResponse.json({ project });
}
