import { renderMarkdown } from "./markdown";
import type { BriefRecord } from "./briefs-store";

/**
 * The brief as a DESIGNED DOCUMENT — a fully self-contained HTML page with
 * print-grade CSS, the way the team's reference brief (USS Xmas 26) was made.
 * Served by /api/tools/brief/[id]/html; the app embeds it in an iframe and
 * printing it (browser print → Save as PDF) yields the finished document,
 * complete and styled — unlike printing the app shell, which clips to the
 * scroll viewport.
 *
 * renderMarkdown escapes all input first, so model output cannot inject
 * markup; everything decorative below is added AFTER escaping.
 */

const escAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Colour-code Load cells and flag TBC/risk text inside rendered tables. */
function decorate(html: string): string {
  const chip = (label: string, cls: string) => `<span class="chip ${cls}">${label}</span>`;
  return (
    html
      // Load column values → chips (only when the value is the whole cell).
      .replace(/<td>(Low|Low[–-]Med)<\/td>/g, (_, v) => `<td>${chip(v, "c-low")}</td>`)
      .replace(/<td>(Med)<\/td>/g, (_, v) => `<td>${chip(v, "c-med")}</td>`)
      .replace(
        /<td>(Med[–-]High|High)<\/td>/g,
        (_, v) => `<td>${chip(v, "c-high")}</td>`
      )
      // Unresolved facts and the flagged schedule risk read in red.
      .replace(/<strong>([^<]*(?:TBC|not in brief|biggest schedule risk)[^<]*)<\/strong>/gi, '<strong class="flag">$1</strong>')
  );
}

export function briefToHtml(brief: BriefRecord): string {
  const body = decorate(renderMarkdown(brief.markdown ?? ""));
  const generated = new Date(brief.finishedAt ?? brief.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escAttr(brief.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fff;
    font-size: 12.5px; line-height: 1.55;
  }
  .doc { max-width: 1180px; margin: 0 auto; padding: 28px 34px 40px; }
  @media print { .doc { max-width: none; padding: 0; } }

  /* Title (md "#" renders as h3) and meta line right under it. */
  .doc h3.md-h {
    font-size: 24px; line-height: 1.25; margin: 0 0 2px; font-weight: 700; color: #111;
  }
  .doc h3.md-h + p.md-p { color: #777; font-size: 11px; margin: 0 0 18px; }

  /* Section headings (md "##" renders as h4) — numbered rule style. */
  .doc h4.md-h {
    font-size: 15px; font-weight: 700; color: #111;
    margin: 22px 0 8px; padding-bottom: 5px; border-bottom: 2px solid #111;
    break-after: avoid;
  }
  .doc h5.md-h { font-size: 13px; font-weight: 700; margin: 14px 0 5px; }

  .doc p.md-p { margin: 0 0 8px; }
  .doc strong { font-weight: 700; color: #000; }
  .doc strong.flag { color: #c0392b; }
  .doc em { color: #333; }
  /* A paragraph that is entirely italic = the "mental model" style callout. */
  .doc p.md-p > em:only-child {
    display: block; border-left: 3px solid #bbb; background: #f5f4f0;
    padding: 8px 12px; margin: 10px 0; font-size: 12.5px; color: #333;
  }

  .doc ul.md-ul, .doc ol.md-ol { margin: 0 0 10px; padding-left: 22px; }
  .doc li { margin: 0 0 5px; }
  .doc a.md-a { color: #1a56a0; }
  .doc code.md-inline-code {
    font-family: ui-monospace, Consolas, monospace; font-size: 11.5px;
    background: #f2f1ec; padding: 1px 4px; border-radius: 3px;
  }

  /* Tables — the reference look: black header band, hairline rows, zebra. */
  .doc .md-table-wrap { margin: 10px 0 14px; }
  .doc table.md-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .doc table.md-table th {
    background: #161616; color: #fff; text-align: left;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
    padding: 6px 9px; border: 1px solid #161616;
  }
  .doc table.md-table td {
    padding: 6px 9px; border: 1px solid #ddd; vertical-align: top;
  }
  .doc table.md-table tbody tr:nth-child(even) td { background: #f7f6f2; }
  .doc table.md-table tr { break-inside: avoid; }

  /* Load chips. */
  .chip {
    display: inline-block; padding: 1px 8px; border-radius: 999px;
    font-size: 10px; font-weight: 700; white-space: nowrap;
  }
  .c-low  { background: #e7f2e4; color: #2e6b2e; }
  .c-med  { background: #fdf0d7; color: #8a5d0b; }
  .c-high { background: #fbe3e0; color: #b03a2e; }

  /* Footer */
  .foot {
    margin-top: 26px; padding-top: 8px; border-top: 1px solid #ddd;
    color: #999; font-size: 10px;
  }
  @media screen {
    .printbar {
      position: sticky; top: 0; background: #161616; color: #eee;
      padding: 8px 16px; font-size: 12px; display: flex; align-items: center; gap: 12px;
    }
    .printbar button {
      background: #3b82f6; color: #fff; border: 0; border-radius: 6px;
      padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer;
    }
  }
  @media print { .printbar { display: none; } }
</style>
</head>
<body>
<div class="printbar">
  <span>Brief document — print to save as PDF (landscape)</span>
  <span style="flex:1"></span>
  <button onclick="window.print()">Print / Save PDF</button>
</div>
<main class="doc md-body">
${body}
<p class="foot">Generated by SuperPixel Assistant from &ldquo;${escAttr(brief.sourceFile)}&rdquo; · requested by ${escAttr(brief.createdBy)} · ${generated} · sanity-check numbers and dates against the client document before quoting.</p>
</main>
</body>
</html>`;
}
