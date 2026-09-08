import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requirePerson } from "@/lib/user-key";
import { extractDocumentText } from "@/lib/extract-server";
import { saveBrief, listBriefs } from "@/lib/briefs-store";
import { generateBrief } from "@/lib/brief-generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // upload+extract only — generation runs in background

const MAX_UPLOAD = 25 * 1024 * 1024;

/** List briefs (newest first, no markdown). */
export async function GET() {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  return NextResponse.json({ briefs: await listBriefs() });
}

/**
 * Start a brief: multipart form with the client document + optional fields.
 * Extraction is synchronous (fast); the Hermes generation runs in the
 * background — the client polls GET /api/tools/brief/[id].
 */
export async function POST(req: NextRequest) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Attach the client document (PDF, DOCX or TXT)" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD) {
    return NextResponse.json({ error: "File too large (25MB max)" }, { status: 400 });
  }
  const contact = String(form.get("contact") ?? "").trim() || undefined;
  const notes = String(form.get("notes") ?? "").trim() || undefined;
  const projectId = String(form.get("projectId") ?? "").trim() || undefined;

  const buf = Buffer.from(await file.arrayBuffer());
  let text: string | null;
  if (/\.(txt|md)$/i.test(file.name) || file.type.startsWith("text/")) {
    text = buf.toString("utf-8").trim() || null;
  } else {
    text = await extractDocumentText(file.name, file.type, buf);
  }
  if (!text || text.length < 200) {
    return NextResponse.json(
      {
        error:
          "Couldn't read enough text from that file — scanned PDFs without a text layer aren't supported yet. Try an exported (not scanned) PDF, DOCX or TXT.",
      },
      { status: 422 }
    );
  }

  const id = `brief-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  await saveBrief({
    id,
    status: "generating",
    title: file.name.replace(/\.[a-z0-9]+$/i, ""),
    sourceFile: file.name,
    projectId,
    contact,
    notes,
    createdBy: gate.person.name,
    createdAt: new Date().toISOString(),
  });

  // Fire and let the request return — status lands in the store either way.
  void generateBrief(id, text, { contact, notes, sourceFile: file.name }).catch(() => {});

  return NextResponse.json({ id });
}
