import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createReadStream } from "fs";
import { Readable } from "stream";
import path from "path";
import crypto from "crypto";
import { requireUser } from "@/lib/user-key";
import { isAllowedRoot, resolveSafe } from "@/lib/fs-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Small resized thumbnails for the Projects listing. Drive images are often
 * multi-MB; serving them raw would make the grid crawl on remote connections.
 * Resized once with sharp, cached on disk keyed by content path + mtime.
 * Falls back to streaming the original if sharp is unavailable or chokes.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const THUMB_DIR = path.join(DATA_DIR, "thumbs");
const WIDTH = 320;

const RAW_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function streamFile(full: string, mime: string, size?: number) {
  const headers: Record<string, string> = {
    "Content-Type": mime,
    // URL carries ?v=<mtime>, so the content behind a URL never changes.
    "Cache-Control": "private, max-age=604800, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (size != null) headers["Content-Length"] = String(size);
  return new Response(Readable.toWeb(createReadStream(full)) as ReadableStream, {
    status: 200,
    headers,
  });
}

export async function GET(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;

  const root = req.nextUrl.searchParams.get("root") ?? "";
  const sub = req.nextUrl.searchParams.get("sub") ?? "";
  if (!root || !(await isAllowedRoot("", root))) {
    return NextResponse.json({ error: "Folder is not registered on any project" }, { status: 403 });
  }
  const full = resolveSafe(root, sub);
  if (!full) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  const ext = path.extname(full).toLowerCase();
  const rawMime = RAW_MIME[ext];
  if (!rawMime) return NextResponse.json({ error: "Not an image" }, { status: 400 });

  let stat;
  try {
    stat = await fs.stat(full);
    if (!stat.isFile()) throw new Error();
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Disk cache keyed by absolute path + mtime — a re-uploaded file re-thumbs.
  const key = crypto.createHash("sha1").update(`${full}|${stat.mtimeMs}|${WIDTH}`).digest("hex");
  const cached = path.join(THUMB_DIR, `${key}.jpg`);

  try {
    const cst = await fs.stat(cached);
    return streamFile(cached, "image/jpeg", cst.size);
  } catch {}

  try {
    const { default: sharp } = await import("sharp");
    const buf = await sharp(full, { failOn: "none" })
      .rotate() // respect EXIF orientation
      .resize({ width: WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    await fs.mkdir(THUMB_DIR, { recursive: true });
    const tmp = cached + `.${process.pid}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, cached).catch(() => {}); // lost race is fine
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=604800, immutable",
        "Content-Length": String(buf.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // sharp missing or unreadable image — serve the original, still correct.
    return streamFile(full, rawMime, stat.size);
  }
}
