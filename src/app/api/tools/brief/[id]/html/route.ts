import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { readBrief } from "@/lib/briefs-store";
import { briefToHtml } from "@/lib/brief-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The brief as a standalone designed document — embed it, print it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  const { id } = await params;
  const brief = await readBrief(id);
  if (!brief || brief.status !== "ready" || !brief.markdown) {
    return NextResponse.json({ error: "Brief not ready" }, { status: 404 });
  }
  return new NextResponse(briefToHtml(brief), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "SAMEORIGIN",
    },
  });
}
