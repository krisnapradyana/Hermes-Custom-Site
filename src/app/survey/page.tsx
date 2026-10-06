"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, HeartPulse, ArrowRight, CheckCircle2, CircleDashed } from "lucide-react";
import { api } from "@/lib/api";

/**
 * Survey hub — dynamic surveys and assessments for the team (Kelvin's ask).
 * One card per instrument; each shows the current window and whether YOU have
 * taken it. Results stay private per the instrument's own rules — this page
 * never shows anyone else's state.
 */

interface StressMeta {
  window: { label: string; closesAt: string };
  me: { taken: boolean };
}

const fmtDaysLeft = (iso: string): string => {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "closing";
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `${d} day${d === 1 ? "" : "s"} left`;
  const h = Math.max(1, Math.floor(ms / 3_600_000));
  return `${h}h left`;
};

export default function SurveyPage() {
  const [stress, setStress] = useState<StressMeta | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await api.get<StressMeta>("/api/survey/stress");
      if (res.ok) setStress(res.data);
      else setError(res.error);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center">
          <ClipboardList size={17} className="text-accent" />
        </div>
        <h1 className="font-serif-display text-3xl">Survey</h1>
      </div>
      <p className="text-sm text-ink-soft mb-8">
        Assessments that keep the studio healthy. Answers are private — aggregates only, per each
        survey&apos;s own rules.
      </p>

      {error && (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-500">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          prefetch={false}
          href="/survey/stress-assessment"
          className="group rounded-xl border border-line bg-card p-4 hover:border-accent/60 transition-colors"
        >
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center">
              <HeartPulse size={15} className="text-accent" />
            </div>
            <p className="font-medium text-[15px] flex-1">Sprint Stress Check</p>
            <ArrowRight
              size={14}
              className="text-ink-faint group-hover:text-accent transition-colors"
            />
          </div>
          <p className="text-[12.5px] text-ink-soft mb-3">
            Bi-weekly pulse on stress and burnout (DASS-21 + CBI). ~3 minutes, one submission per
            sprint; your scores are visible only to you.
          </p>
          <div className="flex items-center gap-2 text-[11.5px]">
            {stress ? (
              <>
                <span className="rounded-full border border-line px-2 py-px text-ink-soft">
                  Sprint {stress.window.label} · {fmtDaysLeft(stress.window.closesAt)}
                </span>
                {stress.me.taken ? (
                  <span className="flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-px font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={11} /> Taken this sprint
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-px font-medium text-amber-600 dark:text-amber-400">
                    <CircleDashed size={11} /> Not taken yet
                  </span>
                )}
              </>
            ) : (
              !error && <span className="text-ink-faint">Loading window…</span>
            )}
          </div>
        </Link>

        <div className="rounded-xl border border-dashed border-line p-4 opacity-60">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div className="w-8 h-8 rounded-lg bg-parchment-dark flex items-center justify-center">
              <ClipboardList size={15} className="text-ink-faint" />
            </div>
            <p className="font-medium text-[15px] flex-1">More assessments</p>
            <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
              soon
            </span>
          </div>
          <p className="text-[12.5px] text-ink-soft">
            New surveys land here as the studio needs them — project retros, onboarding feedback,
            workload pulse.
          </p>
        </div>
      </div>
    </div>
  );
}
