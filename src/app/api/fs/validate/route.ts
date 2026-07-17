import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getUserKey } from "@/lib/user-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Validates that a user-supplied path exists on this machine and is a
 * directory. Used by the project form; the app server runs on the same
 * host as the Hermes agent, so its view of the filesystem matches.
 */
export async function POST(req: NextRequest) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request" }, { status: 400 });
  }

  const p = (body.path ?? "").trim();
  if (!p) return NextResponse.json({ ok: false, message: "Empty path" });
  if (!path.isAbsolute(p)) {
    return NextResponse.json({
      ok: false,
      message: "Use an absolute path (e.g. E:\\Projects\\my-project)",
    });
  }

  try {
    const stat = await fs.stat(p);
    if (!stat.isDirectory()) {
      return NextResponse.json({ ok: false, message: "That path is a file, not a folder" });
    }
    return NextResponse.json({ ok: true, message: "Folder found" });
  } catch {
    return NextResponse.json({ ok: false, message: "Folder not found on this machine" });
  }
}
