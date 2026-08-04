import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createReadStream } from "fs";
import { Readable } from "stream";
import path from "path";
import { requireUser } from "@/lib/user-key";
import { resolveWorkspaceFile } from "@/lib/agent-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams one agent-generated file so the browser can deliver it locally. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  const sub = req.nextUrl.searchParams.get("sub") ?? "";
  const full = sub ? resolveWorkspaceFile(id, sub) : null;
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  try {
    const st = await fs.stat(full);
    if (!st.isFile()) throw new Error();
    const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(st.size),
        "Content-Disposition": `attachment; filename="${path.basename(full).replace(/[^\w.\- ()]+/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
