import { googleAccessToken, GOOGLE_SHEETS_BASE } from "./google-auth";
import { TrackerMapping } from "./tracker-store";
import {
  parseTracker,
  validateMapping,
  parseScheduleGrid,
  MergeRange,
  ScheduleBlock,
} from "./tracker-parse";

/**
 * Assemble the full tracker payload for a project — used by the internal
 * project route AND the public client share route, so both always agree.
 */

export interface TrackerPayload {
  connected: true;
  broken: boolean;
  missing?: string[];
  sheetUrl: string;
  tab: string;
  syncedAt: string;
  shots?: unknown[];
  phases?: string[];
  stats?: unknown;
  schedule?: { tab: string; blocks: ScheduleBlock[] } | { tab: string; error: string };
}

async function sheetsGet(pathAndQuery: string): Promise<Response | null> {
  const token = await googleAccessToken();
  if (!token) return null;
  return fetch(`${GOOGLE_SHEETS_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
}

const tabRange = (tab: string) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);

/** 0-based column index → A1 letter(s): 0→A, 25→Z, 26→AA. */
function colA1(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const cache = new Map<string, { at: number; body: TrackerPayload }>();
export function invalidateTrackerCache(projectId: string): void {
  cache.delete(projectId);
}

export async function buildTrackerPayload(
  projectId: string,
  mapping: TrackerMapping
): Promise<TrackerPayload | { error: string; status: number }> {
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < 60_000) return hit.body;

  const res = await sheetsGet(
    `/v4/spreadsheets/${encodeURIComponent(mapping.sheetId)}/values/${tabRange(mapping.tab)}?majorDimension=ROWS`
  );
  if (!res) return { error: "Google credentials unavailable (documents/token.json)", status: 502 };
  if (!res.ok) return { error: `Sheets API answered ${res.status}`, status: 502 };
  const values = ((await res.json()) as { values?: string[][] }).values ?? [];

  const check = validateMapping(mapping, values);
  if (!check.ok) {
    return {
      connected: true,
      broken: true,
      missing: check.missing,
      sheetUrl: mapping.sheetUrl,
      tab: mapping.tab,
      syncedAt: new Date().toISOString(),
    };
  }

  const parsed = parseTracker(mapping, values);

  // Sketch thumbnails, best-effort: the values API renders an =IMAGE() cell
  // as empty text, but the FORMULA render option exposes the URL. Pasted
  // in-cell images are invisible to the API entirely (documented risk) —
  // those cells simply stay without a preview.
  const thumbCol = mapping.columns.find((c) => c.role === "thumb");
  if (thumbCol && parsed.shots.length > 0) {
    try {
      const a1 = colA1(thumbCol.index);
      const res2 = await sheetsGet(
        `/v4/spreadsheets/${encodeURIComponent(mapping.sheetId)}/values/${encodeURIComponent(
          `'${mapping.tab.replace(/'/g, "''")}'!${a1}:${a1}`
        )}?majorDimension=ROWS&valueRenderOption=FORMULA`
      );
      if (res2?.ok) {
        const col = ((await res2.json()) as { values?: string[][] }).values ?? [];
        for (const shot of parsed.shots) {
          const raw = String(col[shot.rowIndex - 1]?.[0] ?? "");
          const img = raw.match(/=\s*image\s*\(\s*"([^"]+)"/i);
          const link = raw.match(/=\s*hyperlink\s*\(\s*"([^"]+)"/i);
          if (img) shot.thumb = img[1];
          else if (link) shot.thumb = link[1];
          else if (/^https?:\/\//i.test(raw.trim())) shot.thumb = raw.trim();
          else if (shot.thumb && !/^https?:\/\//i.test(shot.thumb)) shot.thumb = undefined;
        }
      }
    } catch {
      /* thumbnails are decoration — never fail the payload over them */
    }
  }

  // Optional Weekly schedule grid → dated blocks (non-fatal on failure).
  let schedule: TrackerPayload["schedule"];
  if (mapping.schedule?.tab) {
    try {
      const [valRes, metaRes] = await Promise.all([
        sheetsGet(
          `/v4/spreadsheets/${encodeURIComponent(mapping.sheetId)}/values/${tabRange(mapping.schedule.tab)}?majorDimension=ROWS`
        ),
        sheetsGet(
          `/v4/spreadsheets/${encodeURIComponent(mapping.sheetId)}?fields=sheets(properties(title),merges)`
        ),
      ]);
      if (!valRes?.ok || !metaRes?.ok) throw new Error("schedule tab unreadable");
      const sVals = ((await valRes.json()) as { values?: string[][] }).values ?? [];
      const meta = (await metaRes.json()) as {
        sheets?: {
          properties?: { title?: string };
          merges?: {
            startRowIndex?: number;
            endRowIndex?: number;
            startColumnIndex?: number;
            endColumnIndex?: number;
          }[];
        }[];
      };
      const sheet = (meta.sheets ?? []).find(
        (s) => s.properties?.title === mapping.schedule!.tab
      );
      const merges: MergeRange[] = (sheet?.merges ?? []).map((m) => ({
        startRow: m.startRowIndex ?? 0,
        endRow: m.endRowIndex ?? 0,
        startCol: m.startColumnIndex ?? 0,
        endCol: m.endColumnIndex ?? 0,
      }));
      schedule = {
        tab: mapping.schedule.tab,
        blocks: parseScheduleGrid(
          sVals,
          merges,
          mapping.schedule.monthRow,
          mapping.schedule.weekRow
        ),
      };
    } catch (err) {
      schedule = {
        tab: mapping.schedule.tab,
        error: err instanceof Error ? err.message : "schedule parse failed",
      };
    }
  }

  const body: TrackerPayload = {
    connected: true,
    broken: false,
    sheetUrl: mapping.sheetUrl,
    tab: mapping.tab,
    syncedAt: new Date().toISOString(),
    ...parsed,
    schedule,
  };
  cache.set(projectId, { at: Date.now(), body });
  return body;
}
