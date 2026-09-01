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
