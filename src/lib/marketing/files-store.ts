import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";

/**
 * Uploaded previews for pipeline cards (dragged onto a card) — the bytes
 * live in DATA_DIR/marketing/files, the card keeps a small reference.
 *
 * Deliberately narrow: images and PDFs only, 10 MB each. Video stays a Drive
 * link (it would fill the server's disk), and SVG/HTML are refused because
 * they can carry script and these files are served back to signed-in users.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** mime type → extension. The stored type is OURS, never the browser's claim. */
export const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "marketing", "files");

/** f-<24 hex>.<ext> — nothing else is ever read from disk. */
const ID_RE = /^f-[a-f0-9]{24}\.(png|jpg|webp|gif|pdf)$/;
export const FILE_URL_RE = /^\/api\/marketing\/files\/f-[a-f0-9]{24}\.(png|jpg|webp|gif|pdf)$/;

export const fileUrl = (id: string) => `/api/marketing/files/${id}`;
export function fileIdFromUrl(url: string): string | null {
  return FILE_URL_RE.test(url) ? url.slice(url.lastIndexOf("/") + 1) : null;
}

/** Check the first bytes really are what the type says (a renamed .exe is not a PNG). */
function looksLike(type: string, b: Buffer): boolean {
  const starts = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  switch (type) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return starts(0x52, 0x49, 0x46, 0x46) && b.subarray(8, 12).toString("latin1") === "WEBP";
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46);
    default:
      return false;
  }
}

export async function saveFile(type: string, buf: Buffer): Promise<{ id: string } | { error: string }> {
  const ext = ALLOWED_TYPES[type];
  if (!ext) return { error: "Only images (PNG, JPG, WebP, GIF) and PDFs can be uploaded — link video from Drive" };
  if (buf.length === 0) return { error: "The file is empty" };
  if (buf.length > MAX_FILE_BYTES) return { error: "The file is larger than 10 MB — link it from Drive instead" };
  if (!looksLike(type, buf)) return { error: "The file does not look like a valid image or PDF" };
  const id = `f-${randomBytes(12).toString("hex")}.${ext}`;
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, id), buf);
  return { id };
}

export async function readFile(id: string): Promise<{ buf: Buffer; type: string } | null> {
  if (!ID_RE.test(id)) return null;
  const ext = id.slice(id.lastIndexOf(".") + 1);
  const type = Object.keys(ALLOWED_TYPES).find((t) => ALLOWED_TYPES[t] === ext);
  if (!type) return null;
  try {
    return { buf: await fs.readFile(path.join(DIR, id)), type };
  } catch {
    return null;
  }
}

export async function deleteFile(id: string): Promise<void> {
  if (!ID_RE.test(id)) return;
  await fs.unlink(path.join(DIR, id)).catch(() => {});
}
