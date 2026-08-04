import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { saveAttachment } from "@/lib/attachment-store";
import { uid } from "@/lib/uid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 8 * 1024 * 1024; // 8MB decoded

export async function POST(req: NextRequest) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { name?: string; type?: string; dataUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const dataUrl = body.dataUrl ?? "";
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return NextResponse.json({ error: "Invalid dataUrl" }, { status: 400 });

  const buf = Buffer.from(dataUrl.slice(comma + 1), "base64");
  if (buf.length > MAX) return NextResponse.json({ error: "File too large" }, { status: 413 });

  const id = uid("att");
  await saveAttachment(id, buf, {
    name: body.name ?? "file",
    type: body.type || "application/octet-stream",
  });
  return NextResponse.json({ id });
}
