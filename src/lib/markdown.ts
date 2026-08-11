/** Minimal markdown → HTML for the workspace inspector (no dependencies).
 *  Input is escaped first, so file content can't inject markup. */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderMarkdown(md: string): string {
  let src = esc(md);

  // Fenced code blocks → placeholders
  const blocks: string[] = [];
  src = src.replace(/```[\w-]*\n([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre class="md-code">${code}</pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  const lines = src.split("\n");
  const out: string[] = [];
  let inList: "ul" | "ol" | false = false;

  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = false;
    }
  };
  const openList = (kind: "ul" | "ol") => {
    if (inList !== kind) {
      closeList();
      out.push(`<${kind} class="md-${kind}">`);
      inList = kind;
    }
  };

  // GitHub-style tables: a |cell| row followed by a |---|---| separator.
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l: string) => /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/.test(l);
  const cells = (l: string) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => inline(c.trim()));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      closeList();
      const head = cells(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isRow(lines[j]) && !isSep(lines[j])) {
        rows.push(cells(lines[j]));
        j++;
      }
      out.push(
        '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
          head.map((c) => `<th>${c}</th>`).join("") +
          "</tr></thead><tbody>" +
          rows.map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>").join("") +
          "</tbody></table></div>"
      );
      i = j - 1;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl + 2} class="md-h">${inline(h[2])}</h${lvl + 2}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(\[( |x|X)\]\s+)?(.*)/);
    if (li) {
      openList("ul");
      const check = li[1] ? (li[2].trim() ? "☑ " : "☐ ") : "";
      out.push(`<li>${check}${inline(li[3])}</li>`);
      continue;
    }
    const oli = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (oli) {
      openList("ol");
      out.push(`<li>${inline(oli[1])}</li>`);
      continue;
    }
    if (line.trim() === "") {
      // A blank line between items of the SAME list type is a "loose list"
      // (very common in agent output, which also numbers every item "1.").
      // Closing the list here made each item its own <ol> restarting at 1 —
      // rendering as "1. 1. 1.". Keep the list open when the next non-empty
      // line continues it; numbering then auto-increments correctly.
      if (inList) {
        const next = lines.slice(i + 1).find((l) => l.trim() !== "");
        const continues =
          next !== undefined &&
          (inList === "ol" ? /^\s*\d+[.)]\s+/.test(next) : /^\s*[-*]\s+/.test(next));
        if (continues) continue;
      }
      closeList();
      out.push("");
      continue;
    }
    closeList();
    out.push(`<p class="md-p">${inline(line)}</p>`);
  }
  closeList();

  let html = out.join("\n");
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
  return html;
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer" class="md-a">$1</a>'
    );
}

export interface ChecklistProgress {
  done: number;
  total: number;
}

export function parseChecklist(md: string): ChecklistProgress | null {
  const boxes = md.match(/^\s*[-*]\s+\[( |x|X)\]/gm);
  if (!boxes || boxes.length === 0) return null;
  const done = boxes.filter((b) => /\[(x|X)\]/.test(b)).length;
  return { done, total: boxes.length };
}
