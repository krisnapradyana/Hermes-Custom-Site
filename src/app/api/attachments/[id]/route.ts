import { NextRequest, NextResponse } from "next/server";
import { getUserKey } from "@/lib/user-key";
import { readAttachment } from "@/lib/attachment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getUserKey())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const found = await readAttachment(id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const download = req.nextUrl.searchParams.get("download") === "1";
  const filename = found.meta.name.replace(/[^\w.\- ()]+/g, "_");
  return new Response(new Uint8Array(found.buf), {
    headers: {
      "Content-Type": found.meta.type,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
