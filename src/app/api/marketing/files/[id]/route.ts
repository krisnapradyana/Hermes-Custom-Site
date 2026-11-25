import { NextRequest, NextResponse } from "next/server";
import { requireMarketingAccess } from "@/lib/marketing-access";
import { readFile } from "@/lib/marketing/files-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve an uploaded preview — marketing access only, never a public URL. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const { id } = await ctx.params;
  const file = await readFile(id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.buf), {
    headers: {
      "content-type": file.type,
      "content-length": String(file.buf.length),
      // Our own type, never sniffed; nothing here may run as a page.
      "x-content-type-options": "nosniff",
      // Images are locked down fully. PDFs get no CSP: a sandbox / default-src
      // policy stops the browser's built-in PDF viewer from opening them.
      ...(file.type === "application/pdf"
        ? {}
        : { "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" }),
      "content-disposition": "inline",
      "cache-control": "private, max-age=86400, immutable",
    },
  });
}
