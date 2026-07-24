import { promises as fs } from "fs";
import path from "path";

/**
 * Server-side storage for uploaded attachment bytes, kept OUT of the per-user
 * state blob (which otherwise bloated with base64 and got re-serialized on
 * every change). State keeps only a small {name,type,size,id} reference.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DIR = path.join(DATA_DIR, "attachments");

const safe = (id: string) => id.replace(/[^\w.-]+/g, "_");

export interface AttachmentMeta {
  name: string;
  type: string;
}

export async function saveAttachment(id: string, buf: Buffer, meta: AttachmentMeta): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, safe(id)), buf);
  await fs.writeFile(path.join(DIR, safe(id) + ".json"), JSON.stringify(meta), "utf-8");
}

export async function readAttachment(
  id: string
): Promise<{ buf: Buffer; meta: AttachmentMeta } | null> {
  try {
    const buf = await fs.readFile(path.join(DIR, safe(id)));
    let meta: AttachmentMeta = { name: id, type: "application/octet-stream" };
    try {
      meta = JSON.parse(await fs.readFile(path.join(DIR, safe(id) + ".json"), "utf-8"));
    } catch {}
    return { buf, meta };
  } catch {
    return null;
  }
}
