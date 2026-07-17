import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createReadStream } from "fs";
import { Readable } from "stream";
import path from "path";
import { getUserKey } from "@/lib/user-key";
import { isAllowedRoot, resolveSafe } from "@/lib/fs-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a workspace file over HTTP with the right content type, so the
 * browser can render it natively (PDF, video, HTML…) or hand it to the
 * user's own apps via the download flow. Works regardless of whether the
 * user and the server are the same machine — the file travels over HTTP.
 */

const MIME: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".pdf": "application/pdf",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".m4v": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav",
  ".m4a": "audio/mp4", ".flac": "audio/flac", ".ogg": "audio/ogg",
  ".zip": "application/zip", ".json": "application/json", ".txt": "text/plain",
  ".csv": "text/csv", ".md": "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function GET(req: NextRequest) {
  const key = await getUserKey();
  if (!key) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const root = req.nextUrl.searchParams.get("root") ?? "";
  const sub = req.nextUrl.searchParams.get("sub") ?? "";
  const download = req.nextUrl.searchParams.get("download") === "1";

  if (!root || !(await isAllowedRoot(key, root))) {
    return NextResponse.json({ error: "Folder is not registered on any project" }, { status: 403 });
  }
  const full = resolveSafe(root, sub);
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  let stat;
  try {
    stat = await fs.stat(full);
    if (!stat.isFile()) throw new Error();
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ext = path.extname(full).toLowerCase();
  const mime = MIME[ext] ?? "application/octet-stream";
  const filename = path.basename(full).replace(/[^\w.\- ()]+/g, "_");

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  };
  // Serve HTML in a unique sandboxed origin: scripts may run for previews,
  // but they can't touch our cookies, storage, or APIs.
  if (mime === "text/html" || mime === "image/svg+xml") {
    headers["Content-Security-Policy"] = "sandbox allow-scripts";
  }

  // Range support so video/audio scrubbing works.
  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        headers["Content-Length"] = String(end - start + 1);
        const stream = Readable.toWeb(
          createReadStream(full, { start, end })
        ) as ReadableStream;
        return new Response(stream, { status: 206, headers });
      }
    }
  }

  headers["Content-Length"] = String(stat.size);
  const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
