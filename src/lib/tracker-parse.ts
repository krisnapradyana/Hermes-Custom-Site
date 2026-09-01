import { TrackerMapping, StatusBucket, TrackerColumn } from "./tracker-store";

/**
 * Pure parsing: sheet values grid + mapping → canonical tracker payload.
 * Kept free of IO so it can be unit-tested against recorded fixtures.
 *
 * Merged cells: the Sheets API returns merged ranges as a value in the
 * anchor cell and EMPTY strings in the continuation cells. Trackers use one
 * logical shot across several sheet rows (one per sketch image), so a row
 * only becomes a shot when it carries a shot id / scene of its own —
 * continuation rows are skipped, and scene carries forward when only the
 * shot column is filled.
 */

export interface PhaseCell {
  statusRaw: string;
  status: StatusBucket;
  assignee?: string;
  link?: string;
}

export interface TrackerShot {
  rowIndex: number; // 1-based sheet row (for deep links)
  scene?: string;
  shotId: string;
  thumb?: string;
  type?: string;
  complexity?: string;
  batch?: string;
  remark?: string;
  phases: Record<string, PhaseCell>;
}

export interface TrackerStats {
  phases: {
    name: string;
    counts: Record<StatusBucket, number>;
    approvedPct: number;
  }[];
  workload: {
    assignee: string;
    perPhase: Record<string, Record<StatusBucket, number>>;
    total: number;
  }[];
  unknownStatuses: { value: string; count: number }[];
  shotCount: number;
  batches: string[];
}

const emptyCounts = (): Record<StatusBucket, number> => ({
  todo: 0,
  in_progress: 0,
  waiting_client: 0,
  revise: 0,
  approved: 0,
  unknown: 0,
});

export function bucketize(raw: string, dict: Record<string, StatusBucket>): StatusBucket {
  const key = raw.trim().toLowerCase();
  if (!key || key === "-") return "todo";
  return dict[key] ?? "unknown";
}

/** Heuristic prefill for the wizard's status dictionary. Order matters. */
export function guessBucket(raw: string): StatusBucket {
  const s = raw.trim().toLowerCase();
  if (!s || s === "-") return "todo";
  if (/approv|final|done|uploaded|complete/.test(s)) return "approved";
  if (/revis|reject|redo|fix/.test(s)) return "revise";
  if (/review|feedback|waiting|pending/.test(s)) return "waiting_client";
  if (/progress|wip|working|doing/.test(s)) return "in_progress";
  if (/to.?do|not assigned|backlog|queue/.test(s)) return "todo";
  return "unknown";
}

const cell = (row: string[], i: number) => (row[i] ?? "").toString().trim();

export function parseTracker(
  mapping: TrackerMapping,
  values: string[][]
): { shots: TrackerShot[]; phases: string[]; stats: TrackerStats } {
  const cols = mapping.columns;
  const byRole = (role: TrackerColumn["role"]) => cols.filter((c) => c.role === role);
  const one = (role: TrackerColumn["role"]) => byRole(role)[0];

  // Phase order = order of phaseStatus columns in the sheet.
  const phases = byRole("phaseStatus").map((c) => c.phase ?? `Phase ${c.index}`);

  const shots: TrackerShot[] = [];
  let carryScene: string | undefined;

  for (let r = mapping.headerRows; r < values.length; r++) {
    const row = values[r] ?? [];
    const sceneCol = one("scene");
    const shotCol = one("shotId");
    const scene = sceneCol ? cell(row, sceneCol.index) : "";
    const shotId = shotCol ? cell(row, shotCol.index) : "";
    if (scene) carryScene = scene;
    // A row is a shot only when it names one — merged continuation rows don't.
    if (!shotId && !scene) continue;

    const shot: TrackerShot = {
      rowIndex: r + 1,
      scene: carryScene,
      shotId: shotId || scene,
      type: one("type") ? cell(row, one("type")!.index) || undefined : undefined,
      complexity: one("complexity")
        ? cell(row, one("complexity")!.index) || undefined
        : undefined,
      batch: one("batch") ? cell(row, one("batch")!.index) || undefined : undefined,
      remark: one("remark") ? cell(row, one("remark")!.index) || undefined : undefined,
      thumb: one("thumb") ? cell(row, one("thumb")!.index) || undefined : undefined,
      phases: {},
    };
    for (const sc of byRole("phaseStatus")) {
      const phase = sc.phase ?? `Phase ${sc.index}`;
      const statusRaw = cell(row, sc.index);
      const assigneeCol = byRole("phaseAssignee").find((c) => c.phase === sc.phase);
      const linkCol = byRole("phaseLink").find((c) => c.phase === sc.phase);
      shot.phases[phase] = {
        statusRaw,
        status: bucketize(statusRaw, mapping.statusDict),
        assignee: assigneeCol ? cell(row, assigneeCol.index) || undefined : undefined,
        link: linkCol ? cell(row, linkCol.index) || undefined : undefined,
      };
    }
    shots.push(shot);
  }

  // ---- stats ----
  const phaseStats = phases.map((name) => {
    const counts = emptyCounts();
    for (const s of shots) counts[s.phases[name]?.status ?? "todo"]++;
    const total = shots.length || 1;
    return { name, counts, approvedPct: Math.round((counts.approved / total) * 100) };
  });

  const workloadMap = new Map<string, { perPhase: Record<string, Record<StatusBucket, number>>; total: number }>();
  for (const s of shots) {
    for (const name of phases) {
      const p = s.phases[name];
      if (!p?.assignee) continue;
      const w = workloadMap.get(p.assignee) ?? { perPhase: {}, total: 0 };
      w.perPhase[name] = w.perPhase[name] ?? emptyCounts();
      w.perPhase[name][p.status]++;
      w.total++;
      workloadMap.set(p.assignee, w);
    }
  }
  const workload = [...workloadMap.entries()]
    .map(([assignee, w]) => ({ assignee, ...w }))
    .sort((a, b) => b.total - a.total);

  const unknownMap = new Map<string, number>();
  for (const s of shots) {
    for (const name of phases) {
      const p = s.phases[name];
      if (p && p.status === "unknown" && p.statusRaw) {
        unknownMap.set(p.statusRaw, (unknownMap.get(p.statusRaw) ?? 0) + 1);
      }
    }
  }

  const batches = [...new Set(shots.map((s) => s.batch).filter(Boolean))] as string[];

  return {
    shots,
    phases,
    stats: {
      phases: phaseStats,
      workload,
      unknownStatuses: [...unknownMap.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
      shotCount: shots.length,
      batches,
    },
  };
}

// ── Weekly schedule grid → dated blocks ─────────────────────────────────────

export interface ScheduleBlock {
  label: string;
  start: string; // YYYY-MM-DD
  end: string;
  row: number;
}

export interface MergeRange {
  startRow: number;
  endRow: number; // exclusive
  startCol: number;
  endCol: number; // exclusive
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIdx = (s: string) => MONTHS.findIndex((m) => s.trim().toLowerCase().startsWith(m));
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Parse a Weekly-style grid (month header row + week-range row + merged
 * block cells) into dated blocks. Week ranges that cross a month boundary
 * ("29-4") are resolved by CONTINUITY with the previous column — the first
 * ambiguous column assumes the labeled month is the start month.
 * A date range inside the block's own label ("(21 Aug - 2 Sept)") overrides
 * the column-derived dates when parseable.
 */
export function parseScheduleGrid(
  values: string[][],
  merges: MergeRange[],
  monthRow: number, // 1-based
  weekRow: number, // 1-based
  year = new Date().getFullYear()
): ScheduleBlock[] {
  const mRow = values[monthRow - 1] ?? [];
  const wRow = values[weekRow - 1] ?? [];
  const width = Math.max(mRow.length, wRow.length);

  // Column → month (carry-forward across merged month headers), with year
  // rollover when the month sequence wraps (DEC → JAN).
  const colMonth: (number | null)[] = [];
  const colYear: number[] = [];
  let curMonth: number | null = null;
  let curYear = year;
  for (let c = 0; c < width; c++) {
    const m = monthIdx((mRow[c] ?? "").toString());
    if (m >= 0) {
      if (curMonth !== null && m < curMonth) curYear++;
      curMonth = m;
    }
    colMonth.push(curMonth);
    colYear.push(curYear);
  }

  // Column → {start, end} from the week range, resolved sequentially.
  const colSpan: ({ start: Date; end: Date } | null)[] = [];
  let prevEnd: Date | null = null;
  for (let c = 0; c < width; c++) {
    const m = colMonth[c];
    const wm = (wRow[c] ?? "").toString().match(/(\d{1,2})\s*[-–]\s*(\d{1,2})/);
    if (m === null || !wm) {
      colSpan.push(null);
      continue;
    }
    const d1 = Number(wm[1]);
    const d2 = Number(wm[2]);
    const y = colYear[c];
    let span: { start: Date; end: Date };
    if (d1 <= d2) {
      span = { start: new Date(y, m, d1), end: new Date(y, m, d2) };
    } else {
      // Crosses a month boundary — labeled month could be start or end.
      const a = { start: new Date(y, m, d1), end: new Date(y, m + 1, d2) };
      const b = { start: new Date(y, m - 1, d1), end: new Date(y, m, d2) };
      if (prevEnd) {
        const gap = (s: Date) => Math.abs(s.getTime() - (prevEnd!.getTime() + 86_400_000));
        span = gap(a.start) <= gap(b.start) ? a : b;
      } else {
        span = a;
      }
    }
    colSpan.push(span);
    prevEnd = span.end;
  }

  // Label-embedded dates, e.g. "(12 - 31 Aug)" or "(21 Aug - 2 Sept)".
  const labelDates = (label: string, baseYear: number): { start: Date; end: Date } | null => {
    const toks = [...label.toLowerCase().matchAll(/(\d{1,2})\s*([a-z]{3,9})?/g)]
      .map((t) => ({ day: Number(t[1]), month: t[2] ? monthIdx(t[2]) : -1 }))
      .filter((t) => t.day >= 1 && t.day <= 31);
    const withMonth = toks.filter((t) => t.month >= 0);
    if (toks.length < 2 || withMonth.length === 0) return null;
    const a = toks[0];
    const b = toks[toks.length - 1];
    const bm = b.month >= 0 ? b.month : withMonth[withMonth.length - 1].month;
    const am = a.month >= 0 ? a.month : bm;
    const start = new Date(baseYear, am, a.day);
    let end = new Date(baseYear, bm, b.day);
    if (end < start) end = new Date(baseYear + 1, bm, b.day);
    return { start, end };
  };

  const inMerge = (r: number, c: number) =>
    merges.find((m) => r >= m.startRow && r < m.endRow && c >= m.startCol && c < m.endCol);

  const blocks: ScheduleBlock[] = [];
  for (let r = weekRow; r < values.length; r++) {
    const row = values[r] ?? [];
    for (let c = 0; c < width; c++) {
      const label = (row[c] ?? "").toString().trim();
      if (!label) continue;
      const merge = inMerge(r, c);
      if (merge && (merge.startRow !== r || merge.startCol !== c)) continue; // continuation
      const cEnd = merge ? Math.min(width, merge.endCol) - 1 : c;
      // Only columns that actually sit under a week range are dated — a label
      // in an undated column (e.g. the category column at the left edge) is
      // a row heading, not a schedule block.
      let startSpan: { start: Date; end: Date } | null = null;
      let endSpan: { start: Date; end: Date } | null = null;
      for (let i = c; i <= cEnd; i++) {
        const s = colSpan[i];
        if (s) {
          startSpan ??= s;
          endSpan = s;
        }
      }
      if (!startSpan || !endSpan) continue;
      const fromLabel = labelDates(label, startSpan.start.getFullYear());
      blocks.push({
        label,
        start: ymd(fromLabel?.start ?? startSpan.start),
        end: ymd(fromLabel?.end ?? endSpan.end),
        row: r + 1,
      });
    }
  }
  return blocks.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Mapping still fits the sheet? Compares saved header text to the current
 * flattened headers; a restructured sheet degrades to "needs attention"
 * instead of rendering wrong data.
 */
export function flattenHeaders(values: string[][], headerRows: number): string[] {
  const width = Math.max(0, ...values.slice(0, Math.max(1, headerRows)).map((r) => r.length));
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const parts: string[] = [];
    for (let r = 0; r < headerRows; r++) {
      const v = (values[r]?.[i] ?? "").toString().trim();
      if (v) parts.push(v);
    }
    out.push(parts.join(" "));
  }
  return out;
}

export function validateMapping(
  mapping: TrackerMapping,
  values: string[][]
): { ok: boolean; missing: string[] } {
  const headers = flattenHeaders(values, mapping.headerRows);
  const missing: string[] = [];
  for (const c of mapping.columns) {
    if (c.role === "ignore" || !c.header) continue;
    const current = (headers[c.index] ?? "").trim();
    if (current !== c.header.trim()) missing.push(`${c.header} (column ${c.index + 1})`);
  }
  return { ok: missing.length === 0, missing };
}
