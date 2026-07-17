import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { spawn } from "child_process";
import { getUserKey } from "@/lib/user-key";
import { isAllowedRoot, resolveSafe } from "@/lib/fs-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Opens a file with the OS default application — the server runs on the
 * same machine as the user, so this behaves like double-clicking the file
 * in Explorer. Restricted to registered project folders.
 */
export async function POST(req: NextRequest) {
  const key = await getUserKey();
  if (!key) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Guard: shell-open only makes sense when the server IS the user's machine.
  // On remote deployments this must stay off — the client falls back to
  // streaming the file to the browser instead.
  if (process.env.ALLOW_LOCAL_OPEN !== "true") {
    return NextResponse.json(
      {
        error:
          "Local open is disabled (set ALLOW_LOCAL_OPEN=true only on single-machine setups).",
      },
      { status: 501 }
    );
  }

  let body: { root?: string; sub?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const root = (body.root ?? "").trim();
  if (!root || !(await isAllowedRoot(key, root))) {
    return NextResponse.json({ error: "Folder is not registered on any project" }, { status: 403 });
  }
  const full = resolveSafe(root, body.sub ?? "");
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const st = await fs.stat(full);
    if (!st.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 400 });

    // spawn with arg arrays (no shell string interpolation).
    let child;
    if (process.platform === "win32") {
      child = spawn("cmd", ["/c", "start", "", full], { detached: true, stdio: "ignore" });
    } else if (process.platform === "darwin") {
      child = spawn("open", [full], { detached: true, stdio: "ignore" });
    } else {
      child = spawn("xdg-open", [full], { detached: true, stdio: "ignore" });
    }
    child.unref();

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not open the file" }, { status: 500 });
  }
}
