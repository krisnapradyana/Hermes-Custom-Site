import { NextRequest, NextResponse } from "next/server";
import { requirePerson } from "@/lib/user-key";
import { googleAccessToken, GOOGLE_SHEETS_BASE } from "@/lib/google-auth";
import { sheetIdFromUrl } from "@/lib/tracker-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wizard data source: for a pasted sheet URL, list the tabs; for a chosen
 * tab, return the whole values grid (capped) so the client can render header
 * candidates, propose column roles, and collect distinct status values —
 * all in one round trip per step.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePerson();
  if (gate.denied) return gate.denied;
  await params; // project id unused — inspection is stateless

  const sheetId = sheetIdFromUrl(req.nextUrl.searchParams.get("url") ?? "");
  if (!sheetId) return NextResponse.json({ error: "Not a Google Sheets URL" }, { status: 400 });
  const tab = req.nextUrl.searchParams.get("tab") ?? "";

  const token = await googleAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: "Google credentials unavailable (documents/token.json)" },
      { status: 502 }
    );
  }
  const auth = { Authorization: `Bearer ${token}` };

  try {
    const metaRes = await fetch(
      `${GOOGLE_SHEETS_BASE}/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=properties.title,sheets.properties.title`,
      { headers: auth, signal: AbortSignal.timeout(15_000) }
    );
    if (!metaRes.ok) {
      return NextResponse.json(
        { error: `Sheets API answered ${metaRes.status} — is the sheet shared with the company account?` },
        { status: 502 }
      );
    }
    const meta = (await metaRes.json()) as {
      properties?: { title?: string };
      sheets?: { properties?: { title?: string } }[];
    };
    const tabs = (meta.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
    const chosen = tab || tabs[0];
    if (!chosen) return NextResponse.json({ error: "No tabs found" }, { status: 400 });

    const valRes = await fetch(
      `${GOOGLE_SHEETS_BASE}/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`'${chosen.replace(/'/g, "''")}'`)}?majorDimension=ROWS`,
      { headers: auth, signal: AbortSignal.timeout(20_000) }
    );
    if (!valRes.ok) {
      return NextResponse.json({ error: `Could not read tab "${chosen}"` }, { status: 502 });
    }
    const vals = (await valRes.json()) as { values?: string[][] };
    const values = (vals.values ?? []).slice(0, 800).map((r) => r.slice(0, 60));

    return NextResponse.json({
      sheetId,
      title: meta.properties?.title ?? "",
      tabs,
      tab: chosen,
      values,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Sheets error: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }
}
