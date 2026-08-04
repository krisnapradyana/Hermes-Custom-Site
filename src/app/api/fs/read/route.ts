import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { requireUser } from "@/lib/user-key";
import { isAllowedRoot, resolveSafe } from "@/lib/fs-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".sh",
  ".sql",
  ".css",
  ".scss",
  ".html",
  ".json",
  ".yml",
  ".yaml",
  ".xml",
  ".toml",
  ".ini",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".cs",
  ".rb",
  ".php",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
]);
const TEXT_EXT = new Set([".txt", ".csv", ".tsv", ".log", ".env"]);

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_TEXT = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const gate = await requireUser();
  if (gate.denied) return gate.denied;
  const key = gate.key;

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

    const ext = path.extname(full).toLowerCase();

    if (IMAGE_MIME[ext]) {
      if (st.size > MAX_IMAGE) return NextResponse.json({ kind: "binary", size: st.size });
      const buf = await fs.readFile(full);
      return NextResponse.json({
        kind: "image",
        dataUrl: `data:${IMAGE_MIME[ext]};base64,${buf.toString("base64")}`,
        size: st.size,
      });
    }

    const isMd = ext === ".md" || ext === ".markdown";
    if (isMd || CODE_EXT.has(ext) || TEXT_EXT.has(ext) || ext === "") {
      if (st.size > MAX_TEXT) return NextResponse.json({ kind: "binary", size: st.size });
      const content = await fs.readFile(full, "utf-8");
      return NextResponse.json({
        kind: isMd ? "markdown" : CODE_EXT.has(ext) ? "code" : "text",
        content,
        size: st.size,
      });
    }

    return NextResponse.json({ kind: "binary", size: st.size });
  } catch {
    return NextResponse.json({ error: "Could not read file" }, { status: 404 });
  }
}
