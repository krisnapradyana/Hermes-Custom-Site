import { NextRequest, NextResponse } from "next/server";
import { pendingReviewers, readCards } from "@/lib/marketing/pipeline-store";
import { dmByName, marketingUrl } from "@/lib/marketing/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily reminder sweep for the content pipeline — meant to be called once
 * each working morning by a cron job on the server (x-internal-token).
 * One digest DM per person, only if they have something:
 *   - their cards that are overdue or due today (not Published / banked)
 *   - cards waiting on their approval for 2+ days
 * Add ?dry=1 to see who would get what without sending anything.
 */

const DAY = 86_400_000;

export async function POST(req: NextRequest) {
  const token = process.env.INTERNAL_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.headers.get("x-internal-token") !== token) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: process.env.MARKETING_TZ ?? "Asia/Jakarta",
  });
  const cards = await readCards();
  const lines = new Map<string, string[]>();
  const add = (name: string, line: string) => lines.set(name, [...(lines.get(name) ?? []), line]);

  for (const c of cards) {
    if (c.stage === "Bank" || c.stage === "Published") continue;
    if (c.owner && c.due && c.due <= today && c.stage !== "Review") {
      add(c.owner, `• ${c.due < today ? `*Overdue* (due ${c.due})` : "*Due today*"} — ${c.title} · ${c.stage}`);
    }
    const pending = c.stage === "Review" ? pendingReviewers(c) : [];
    if (pending.length) {
      let since = new Date(c.updatedAt).getTime();
      for (let i = c.comments.length - 1; i >= 0; i--) {
        const m = c.comments[i];
        if (m.sys && m.text.endsWith("to Review")) {
          since = new Date(m.at).getTime();
          break;
        }
      }
      const days = Math.floor((Date.now() - since) / DAY);
      if (days >= 2) for (const name of pending) add(name, `• *Waiting for your approval* (${days} days) — ${c.title}`);
    }
  }

  const url = marketingUrl();
  const report: { name: string; items: number; sent: boolean | null }[] = [];
  for (const [name, items] of lines) {
    const text = `📣 Content pipeline — today:\n${items.join("\n")}${url ? `\n${url}` : ""}`;
    const sent = dry ? null : await dmByName(name, text);
    report.push({ name, items: items.length, sent });
  }
  return NextResponse.json({ dry, today, people: report });
}
