"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ShieldCheck, ArrowLeft, ArrowRight, CheckCircle2, HeartPulse } from "lucide-react";
import { api } from "@/lib/api";
import {
  DASS_ITEMS,
  CBI_P_ITEMS,
  CBI_W_ITEMS,
  FREE_TEXT_ITEM,
  SCALES,
  INSTRUMENT_VERSION,
  Item,
  Scores,
} from "@/lib/stress-instrument";

/**
 * Sprint Stress Check — hidden page (no sidebar entry yet); reachable at
 * /survey/stress-assessment. Flow per spec: privacy screen every sprint →
 * three question screens → review → private result with personal trend.
 * Leadership additionally sees the team stress meter below.
 */

type MeterState = "low" | "moderate" | "high" | "severe" | "invalid" | "none";

interface SurveyData {
  window: { label: string; closesAt: string };
  me: {
    name: string;
    taken: boolean;
    current: { scores: Scores; band: string | null; submittedAt: string } | null;
    trend: { window: string; score: number }[];
  };
  isLeadership: boolean;
  meter: { userKey: string; name: string; state: MeterState; lastAt?: string }[] | null;
  aggregate: {
    responseN: number;
    published: boolean;
    meanStress: number | null;
    comments: string[] | null;
  };
  minAggregateN: number;
}

const BAND_META: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: "Low", color: "#4ade9d", bg: "rgba(29,158,117,0.18)" },
  moderate: { label: "Moderate", color: "#e0c277", bg: "rgba(211,181,95,0.16)" },
  high: { label: "High", color: "#f09a5e", bg: "rgba(232,118,45,0.18)" },
  severe: { label: "Severe", color: "#f08a89", bg: "rgba(226,75,74,0.2)" },
  invalid: { label: "Invalid", color: "#8a93a3", bg: "transparent" },
  none: { label: "None", color: "#6e7684", bg: "transparent" },
};

const DRAFT_KEY = "stress-draft";

export default function StressAssessmentPage() {
  const [data, setData] = useState<SurveyData | null>(null);
  const load = useCallback(() => {
    api.get<SurveyData>("/api/survey/stress").then((r) => r.ok && setData(r.data));
  }, []);
  useEffect(load, [load]);

  // steps: 0 privacy · 1 DASS · 2 CBI-P · 3 CBI-W · 4 review · 5 result
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [freeText, setFreeText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ scores: Scores; band: string | null } | null>(null);

  // Draft auto-save (local, private to this browser), per window.
  useEffect(() => {
    if (!data) return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.window === data.window.label) {
          setAnswers(d.answers ?? {});
          setFreeText(d.freeText ?? "");
        }
      }
    } catch {}
  }, [data]);
  useEffect(() => {
    if (!data || step === 0 || step === 5) return;
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ window: data.window.label, answers, freeText })
      );
    } catch {}
  }, [answers, freeText, step, data]);

  const screens: { title: string; stem: string; items: Item[] }[] = useMemo(
    () => [
      {
        title: "Stress · 1 of 3",
        stem: "Over the past two weeks, how much did each statement apply to you?",
        items: DASS_ITEMS,
      },
      { title: "Personal burnout · 2 of 3", stem: "Over the past two weeks…", items: CBI_P_ITEMS },
      {
        title: "Work-related burnout · 3 of 3",
        stem: "Thinking about your work over the past two weeks…",
        items: CBI_W_ITEMS,
      },
    ],
    []
  );

  const allItems = useMemo(() => [...DASS_ITEMS, ...CBI_P_ITEMS, ...CBI_W_ITEMS], []);
  const answeredAll = allItems.every((i) => answers[i.id] !== undefined);
  const screenDone = (idx: number) => screens[idx].items.every((i) => answers[i.id] !== undefined);

  const submit = async () => {
    if (busy || !answeredAll) return;
    setBusy(true);
    setError("");
    const res = await api.post<{ scores: Scores; band: string | null }>("/api/survey/stress", {
      instrument_version: INSTRUMENT_VERSION,
      answers,
      free_text: freeText.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    setResult(res.data);
    setStep(5);
    load();
  };

  if (!data) {
    return <div className="flex h-full items-center justify-center text-sm text-ink-faint">Loading…</div>;
  }

  const closes = new Date(data.window.closesAt);
  const daysLeft = Math.max(0, Math.ceil((+closes - Date.now()) / 86_400_000));

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft">
          <HeartPulse size={18} className="text-accent" />
        </div>
        <div className="min-w-[200px] flex-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Sprint Stress Check</h1>
          <p className="text-[12.5px] text-ink-soft">
            Window {data.window.label} · closes in {daysLeft} day{daysLeft === 1 ? "" : "s"} · ~3
            minutes · 20 questions
          </p>
        </div>
        {data.me.taken && step < 5 && (
          <span className="rounded-full bg-green-500/10 px-3 py-1 text-[11.5px] font-medium text-green-600 dark:text-green-400">
            ✓ Taken this sprint — retaking overwrites
          </span>
        )}
      </div>

      {/* ---- STEP 0 · privacy, shown every sprint ---- */}
      {step === 0 && (
        <div className="glass-panel rounded-2xl border border-line/60 p-6">
          <p className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
            <ShieldCheck size={16} className="text-green-500" />
            Before you start — who sees what
          </p>
          <ul className="mb-4 space-y-1.5 text-[13px] text-ink-soft">
            <li>· Your answers and your score are visible to you and no one else.</li>
            <li>
              · Leads see the team picture: stress bands and aggregates — never your questionnaire
              answers, and team averages only when at least {data.minAggregateN} people responded.
            </li>
            <li>· The optional comment is shown to leads anonymised and shuffled, never attributed.</li>
            <li>· This is a self-check, not a diagnosis, and is never used for performance review.</li>
          </ul>
          <p className="mb-4 text-[11.5px] text-ink-faint">
            Instruments: DASS-21 Stress subscale (Lovibond & Lovibond, 1995) and the Copenhagen
            Burnout Inventory (Kristensen et al., 2005), adapted to a two-week time frame.
          </p>
          <button
            onClick={() => setStep(1)}
            className="rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white hover:bg-accent-hover"
          >
            Start
          </button>
        </div>
      )}

      {/* ---- STEPS 1–3 · question screens ---- */}
      {step >= 1 && step <= 3 && (
        <div className="glass-panel rounded-2xl border border-line/60 p-6">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[13px] font-semibold">{screens[step - 1].title}</p>
            <span className="text-[11px] text-ink-faint">draft auto-saved</span>
          </div>
          <div className="mb-4 h-1 rounded-full bg-parchment-dark">
            <div
              className="h-1 rounded-full bg-accent transition-all"
              style={{ width: `${(step / 4) * 100}%` }}
            />
          </div>
          <p className="mb-4 text-[13px] text-ink-soft">{screens[step - 1].stem}</p>
          <div className="space-y-4">
            {screens[step - 1].items.map((item, qi) => (
              <div key={item.id}>
                <p className="mb-1.5 text-[13px]">
                  <span className="text-ink-faint">{qi + 1} · </span>
                  {item.text}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {SCALES[item.scale].map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setAnswers((a) => ({ ...a, [item.id]: o.value }))}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors ${
                        answers[item.id] === o.value
                          ? "border-accent bg-accent-soft text-accent font-medium"
                          : "border-line text-ink-soft hover:border-ink-faint"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {step === 3 && (
              <div>
                <p className="mb-1.5 text-[13px]">
                  <span className="text-ink-faint">8 · </span>
                  {FREE_TEXT_ITEM.text} <span className="text-ink-faint">(optional)</span>
                </p>
                <textarea
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value.slice(0, FREE_TEXT_ITEM.maxLength))}
                  rows={3}
                  className="w-full rounded-xl border border-line bg-card/60 px-3 py-2 text-[13px] outline-none focus:border-accent"
                />
                <p className="text-right text-[10.5px] text-ink-faint">
                  {freeText.length} / {FREE_TEXT_ITEM.maxLength}
                </p>
              </div>
            )}
          </div>
          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={() => setStep(step - 1)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-[13px] text-ink-soft hover:border-ink-faint"
            >
              <ArrowLeft size={13} /> Back
            </button>
            <button
              onClick={() => setStep(step + 1)}
              disabled={!screenDone(step - 1)}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {step === 3 ? "Review" : "Next"} <ArrowRight size={13} />
            </button>
            {!screenDone(step - 1) && (
              <span className="text-[11px] text-ink-faint">all questions on this screen are required</span>
            )}
          </div>
        </div>
      )}

      {/* ---- STEP 4 · review & submit ---- */}
      {step === 4 && (
        <div className="glass-panel rounded-2xl border border-line/60 p-6">
          <p className="mb-3 text-[13px] font-semibold">Review — tap any answer to change it</p>
          <div className="mb-4 max-h-[320px] space-y-1 overflow-y-auto pr-1">
            {allItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setStep(item.id.startsWith("D") ? 1 : item.id.startsWith("P") ? 2 : 3)}
                className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-parchment-dark/40"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">
                  {item.id} · {item.text}
                </span>
                <span className="shrink-0 text-[12px] font-medium">
                  {SCALES[item.scale].find((o) => o.value === answers[item.id])?.label ?? "—"}
                </span>
              </button>
            ))}
          </div>
          {error && <p className="mb-3 text-[12.5px] text-red-500">{error}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStep(3)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-[13px] text-ink-soft hover:border-ink-faint"
            >
              <ArrowLeft size={13} /> Back
            </button>
            <button
              onClick={submit}
              disabled={busy || !answeredAll}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              <CheckCircle2 size={14} />
              {busy ? "Scoring…" : "Submit"}
            </button>
          </div>
        </div>
      )}

      {/* ---- STEP 5 · private result ---- */}
      {step === 5 && result && result.scores.stress_score !== null && (
        <div className="glass-panel rounded-2xl border border-line/60 p-6">
          <div className="flex flex-wrap items-center gap-6">
            <ScoreDial score={result.scores.stress_score} band={result.band ?? "low"} />
            <div className="space-y-1 text-[12.5px] text-ink-soft">
              <p>
                Stress (DASS-21): <b>{Math.round(result.scores.dass_stress!)}</b>
                {result.scores.flags.dass && <Flag />}
              </p>
              <p>
                Personal burnout: <b>{Math.round(result.scores.cbi_personal!)}</b>
                {result.scores.flags.cbi_personal && <Flag />}
              </p>
              <p>
                Work burnout: <b>{Math.round(result.scores.cbi_work!)}</b>
                {result.scores.flags.cbi_work && <Flag />}
              </p>
            </div>
          </div>
          {data.me.trend.length > 1 && (
            <div className="mt-5">
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                Your trend (only you see this)
              </p>
              <Trend trend={data.me.trend} />
            </div>
          )}
          <p className="mt-4 text-[11px] text-ink-faint">
            Bands are an internal colour convention, not a validated clinical cutoff. This is a
            self-check, not a diagnosis — if these numbers worry you, talk to Puput or your lead.
          </p>
        </div>
      )}

      {/* ---- Leadership: team stress meter ---- */}
      {data.isLeadership && data.meter && (
        <div className="mt-6 rounded-2xl border border-line bg-card px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold">Team stress meter · {data.window.label}</p>
            <span className="text-[11.5px] text-ink-faint">
              {data.aggregate.responseN} response{data.aggregate.responseN === 1 ? "" : "s"}
              {data.aggregate.published && data.aggregate.meanStress !== null
                ? ` · team mean ${Math.round(data.aggregate.meanStress)}`
                : ` · mean hidden until ${data.minAggregateN}+`}
            </span>
            <span className="ml-auto text-[10.5px] text-ink-faint">leadership only</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.meter.map((m) => {
              const meta = BAND_META[m.state];
              return (
                <div key={m.userKey} className="flex items-center gap-2 rounded-lg bg-parchment-dark/40 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px]">{m.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10.5px] font-medium ${
                      m.state === "invalid" || m.state === "none" ? "border border-dashed border-line" : ""
                    }`}
                    style={{ color: meta.color, backgroundColor: meta.bg }}
                  >
                    {meta.label}
                    {m.state === "invalid" && m.lastAt
                      ? ` · ${Math.round((Date.now() - +new Date(m.lastAt)) / 86_400_000)}d ago`
                      : ""}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10.5px] text-ink-faint">
            Invalid = assessed, but not this sprint · None = never assessed — both need a nudge.
            Bands, never scores; questionnaire answers are never shown.
          </p>
          {data.aggregate.comments && (
            <div className="mt-3">
              <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                Anonymous comments ({data.aggregate.comments.length})
              </p>
              <ul className="space-y-1 text-[12px] text-ink-soft">
                {data.aggregate.comments.map((c, i) => (
                  <li key={i} className="rounded-lg bg-parchment-dark/40 px-2.5 py-1.5">&ldquo;{c}&rdquo;</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Flag() {
  return <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">above threshold</span>;
}

function ScoreDial({ score, band }: { score: number; band: string }) {
  const meta = BAND_META[band] ?? BAND_META.low;
  const C = 2 * Math.PI * 15.9;
  return (
    <svg width="110" height="110" viewBox="0 0 42 42" role="img">
      <title>Your stress score</title>
      <circle cx="21" cy="21" r="15.9" fill="none" strokeWidth="5" className="stroke-line" />
      <circle
        cx="21"
        cy="21"
        r="15.9"
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        stroke={meta.color}
        strokeDasharray={`${(score / 100) * C} ${C}`}
        transform="rotate(-90 21 21)"
      />
      <text x="21" y="20" textAnchor="middle" className="fill-ink" style={{ fontSize: "9px", fontWeight: 600 }}>
        {Math.round(score)}
      </text>
      <text x="21" y="27.5" textAnchor="middle" style={{ fontSize: "3.6px", fill: meta.color, fontWeight: 600, letterSpacing: "0.08em" }}>
        {meta.label.toUpperCase()}
      </text>
    </svg>
  );
}

function Trend({ trend }: { trend: { window: string; score: number }[] }) {
  const w = 280, h = 44;
  const pts = trend.map((t, i) => ({
    x: 8 + (i / Math.max(1, trend.length - 1)) * (w - 16),
    y: h - 6 - (t.score / 100) * (h - 12),
  }));
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        className="stroke-accent"
        strokeWidth="2"
      />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 3 : 2} className="fill-accent" />
      ))}
    </svg>
  );
}
