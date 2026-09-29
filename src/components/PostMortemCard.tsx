"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Lightbulb, Sparkles, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { renderMarkdown } from "@/lib/markdown";
import { useFocusRefresh } from "@/lib/use-focus-refresh";

/**
 * Post-mortem / wisdom card on the project page: response count, average
 * self-ratings, the Hermes-distilled document, and the door to add your own
 * reflection. Rendered once the project has any responses, or once it's a
 * wrapped flagship (so the empty state nudges the team).
 */

interface Pm {
  responses: {
    userKey: string;
    name: string;
    involvement: string;
    at: string;
    ratings: Record<string, number>;
    isWrap?: boolean;
  }[];
  distilled?: { md: string; at: string; fromResponses: number };
}

const RATING_LABELS: [string, string][] = [
  ["perception", "Perception"],
  ["communication", "Communication"],
  ["speed", "Speed"],
  ["creativity", "Creativity"],
  ["outcome", "Outcome"],
];

export function PostMortemCard({ projectId, isFlagship, isDone }: { projectId: string; isFlagship: boolean; isDone: boolean }) {
  const [pm, setPm] = useState<Pm | null>(null);
  const [distilling, setDistilling] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api
      .get<{ postmortem: Pm }>(`/api/projects/${encodeURIComponent(projectId)}/postmortem`)
      .then((r) => r.ok && setPm(r.data.postmortem));
  }, [projectId]);
  useEffect(load, [load]);
  useFocusRefresh(load);

  const distill = async () => {
    if (distilling) return;
    setDistilling(true);
    setError("");
    const res = await api.post<{ postmortem: Pm }>(
      `/api/projects/${encodeURIComponent(projectId)}/postmortem/distill`,
      {}
    );
    setDistilling(false);
    if (!res.ok) setError(res.error);
    else setPm(res.data.postmortem);
  };

  if (!pm) return null;
  const n = pm.responses.length;
  if (n === 0 && !(isFlagship && isDone)) return null;

  const avg = (key: string) =>
    n === 0 ? 0 : Math.round((pm.responses.reduce((a, r) => a + (r.ratings[key] ?? 0), 0) / n) * 10) / 10;
  const staleDistill = pm.distilled && pm.distilled.fromResponses < n;

  return (
    <div className="mb-8 rounded-xl border border-line bg-card px-4 py-3">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Lightbulb size={14} className="text-amber-500" />
        <p className="text-sm font-medium">Post-mortem — project wisdom</p>
        <span className="text-[12px] text-ink-faint">
          {n} reflection{n === 1 ? "" : "s"}
        </span>
        <span className="flex-1" />
        <Link
          prefetch={false}
          href={`/projects/${encodeURIComponent(projectId)}/wrap`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-ink-soft hover:border-ink-faint hover:text-ink transition-colors"
        >
          <UserPlus size={12} />
          Add / edit my reflection
        </Link>
        {n > 0 && (
          <button
            onClick={distill}
            disabled={distilling}
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/50 bg-accent-soft/40 px-2.5 py-1.5 text-[12px] text-accent hover:bg-accent-soft disabled:opacity-50 transition-colors"
            title="Hermes merges all reflections into the wisdom document"
          >
            <Sparkles size={12} />
            {distilling ? "Distilling…" : pm.distilled ? "Re-distill" : "Distill with Hermes"}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-[12px] text-red-500">{error}</p>}

      {n > 0 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {RATING_LABELS.map(([key, label]) => (
            <span key={key} className="text-[11.5px] text-ink-faint">
              {label}{" "}
              <span className="font-medium tabular-nums text-ink-soft">{avg(key)}</span>
              <span className="text-ink-faint">/5</span>
            </span>
          ))}
          <span className="text-[11.5px] text-ink-faint">
            · {pm.responses.map((r) => r.name.split(" ")[0]).join(", ")}
          </span>
        </div>
      )}

      {pm.distilled ? (
        <>
          {staleDistill && (
            <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-600 dark:text-amber-400">
              New reflections arrived since the last distillation — re-distill to include them.
            </p>
          )}
          <div
            className="md-body text-[13px]"
            // Safe: renderMarkdown escapes all input before transforming.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(pm.distilled.md) }}
          />
          <p className="mt-2 text-[11px] text-ink-faint">
            Distilled by Hermes from {pm.distilled.fromResponses} reflection
            {pm.distilled.fromResponses === 1 ? "" : "s"} ·{" "}
            {new Date(pm.distilled.at).toLocaleString()} · attached to this project permanently
          </p>
        </>
      ) : n > 0 ? (
        <p className="text-[12.5px] text-ink-faint">
          Reflections are in — press{" "}
          <span className="font-medium text-ink-soft">Distill with Hermes</span> to turn them into
          the wisdom document.
        </p>
      ) : (
        <p className="text-[12.5px] text-ink-faint">
          This flagship project wrapped, but nobody has reflected yet — be the first.
        </p>
      )}
    </div>
  );
}
