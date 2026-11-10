import { NextRequest, NextResponse } from "next/server";
import { requireMarketingAccess } from "@/lib/marketing-access";
import { CHECKERS, CHECKER_IDS } from "@/lib/marketing/checker-prompts";
import { HOUSE_RULES, addReference, readReferences, removeReference } from "@/lib/marketing/library-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Library & Rules — approved reference docs (editable links), the checker
 * prompts exactly as they run (read-only here, versioned in code), and the
 * house-rules digest. Prompt text is only ever sent to allowed viewers.
 */

export async function GET() {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  return NextResponse.json({
    references: await readReferences(),
    prompts: CHECKER_IDS.map((id) => {
      const c = CHECKERS[id];
      return { id: c.id, label: c.label, version: c.version, text: c.system };
    }),
    rules: HOUSE_RULES,
  });
}

/** Add a reference link. Body: { title, url, note? } */
export async function POST(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const body = (await req.json().catch(() => null)) as { title?: unknown; url?: unknown; note?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (title.length < 2) return NextResponse.json({ error: "A title is required" }, { status: 400 });
  // Rendered as a clickable link — plain http(s) only.
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return NextResponse.json({ error: "The link must start with http:// or https://" }, { status: 400 });
  }
  const reference = await addReference(
    { title, url, note: typeof body?.note === "string" ? body.note : "" },
    gate.viewer.name
  );
  return NextResponse.json({ reference });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireMarketingAccess();
  if (gate.denied) return gate.denied;

  const ok = await removeReference(req.nextUrl.searchParams.get("id") ?? "");
  if (!ok) return NextResponse.json({ error: "Reference not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
