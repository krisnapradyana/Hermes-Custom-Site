import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getUserKey } from "@/lib/user-key";
import { isAllowedRoot, resolveSafe } from "@/lib/fs-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DOWNLOAD = 200 * 1024 * 1024; // 200MB

export async function GET(req: NextRequest) {
  const key = await getUserKey();
  if (!key) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const root = (req.nextUrl.searchParams.get("root") ?? "").trim();
  const sub = req.nextUrl.searchParams.get("sub") ?? "";
  if (!root || !(await isAllowedRoot(key, root))) {
    return NextResponse.json({ error: "Folder is not registered on any project" }, { status: 403 });
  }
  const full = resolveSafe(root, sub);
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const st = await fs.stat(full);
    if (!st.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 400 });
    if (st.size > MAX_DOWNLOAD) {
      return NextResponse.json({ error: "File too large to download here" }, { status: 413 });
    }
    const buf = await fs.readFile(full);
    const name = path.basename(full).replace(/["\\\r\n]/g, "_");
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(st.size),
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not read file" }, { status: 404 });
  }
}
