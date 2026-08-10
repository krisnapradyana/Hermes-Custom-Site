"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Clock, Play, Pause, RefreshCw, Zap, Settings2 } from "lucide-react";
import { describeCron, buildCron, timeAgo, Frequency } from "@/lib/format";
import { api, type ApiResult } from "@/lib/api";
import { IconButton } from "@/components/ui";

/**
 * Phase 4a: this page reflects the agent's REAL scheduled jobs via
 * Hermes' /api/jobs (proxied at /api/cron) — the same jobs `hermes cron`
 * manages, including ones created from Slack or the CLI.
 *
 * TEMPORARILY GATED: the feature isn't reliable enough for team use yet, so
 * the page shows an under-development notice (sidebar entry is greyed out
 * too). Flip SCHEDULER_ENABLED to true to restore it — nothing was removed.
 */
const SCHEDULER_ENABLED = false;

function UnderDevelopment() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-6">
      <div className="w-12 h-12 rounded-2xl bg-accent-soft flex items-center justify-center">
        <Clock size={22} className="text-accent" />
      </div>
      <h1 className="font-serif-display text-2xl">Scheduler</h1>
      <p className="text-sm text-ink-soft max-w-sm">
        This feature is under development — it will let you schedule recurring tasks for the
        assistant (daily briefings, weekly reports) without writing any cron syntax.
      </p>
      <p className="text-[12px] text-ink-faint">Coming soon.</p>
    </div>
  );
}

interface JobView {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  lastRunAt?: string;
  lastStatus?: string;
  raw: Record<string, unknown>;
}

function mapJob(j: Record<string, unknown>): JobView {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    id: str(j.id) ?? str(j.job_id) ?? JSON.stringify(j).slice(0, 24),
    name: str(j.name) ?? str(j.title) ?? str(j.id) ?? "job",
    schedule: str(j.schedule) ?? str(j.cron) ?? str(j.cron_expression) ?? "",
    prompt: str(j.prompt) ?? str(j.input) ?? str(j.command) ?? "",
    enabled: (j.enabled as boolean | undefined) ?? !((j.paused as boolean | undefined) ?? false),
    lastRunAt: str(j.last_run_at) ?? str(j.lastRunAt) ?? str(j.last_run),
    lastStatus: str(j.last_status) ?? str(j.lastStatus) ?? str(j.status),
    raw: j,
  };
}

function extractJobs(data: unknown): JobView[] {
  const list = Array.isArray(data)
    ? data
    : (((data as Record<string, unknown>)?.jobs as unknown[]) ??
      ((data as Record<string, unknown>)?.data as unknown[]) ??
      []);
  return (list as Record<string, unknown>[]).map(mapJob);
}

export default function CronPage() {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");

  // Friendly schedule inputs — the cron expression is generated automatically.
  const [freq, setFreq] = useState<Frequency>("daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [advanced, setAdvanced] = useState(false);
  const [rawSchedule, setRawSchedule] = useState("");

  const schedule =
    advanced && rawSchedule.trim()
      ? rawSchedule.trim()
      : buildCron(freq, time, weekday, dayOfMonth);

  const refresh = useCallback(async () => {
    if (!SCHEDULER_ENABLED) return;
    setError("");
    const res = await api.get<unknown>("/api/cron");
    if (!res.ok) {
      setError(res.error);
      setJobs([]);
    } else {
      setJobs(extractJobs(res.data));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!SCHEDULER_ENABLED) return <UnderDevelopment />;

  const act = async (id: string, doIt: () => Promise<ApiResult<unknown>>) => {
    setBusy(id);
    try {
      const res = await doIt();
      if (!res.ok) console.warn(`[cron] job action failed: ${res.error}`);
      await refresh();
    } finally {
      setBusy("");
    }
  };

  const create = async () => {
    if (!prompt.trim()) return;
    setBusy("new");
    try {
      const res = await api.post("/api/cron", {
        name: name.trim() || undefined,
        schedule,
        prompt: prompt.trim(),
      });
      if (!res.ok) console.warn(`[cron] create failed: ${res.error}`);
      setName("");
      setPrompt("");
      setShowForm(false);
      await refresh();
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif-display text-3xl mb-1">Scheduler</h1>
          <p className="text-sm text-ink-soft">
            Things the assistant does automatically, on your schedule.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <IconButton onClick={refresh} title="Refresh">
            <RefreshCw size={15} />
          </IconButton>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={15} />
            New task
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-8 rounded-xl border border-line bg-card p-5 space-y-4">
          {/* 1. What */}
          <div>
            <p className="text-sm font-medium mb-1.5">What should the assistant do?</p>
            <textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='e.g. "Send me a summary of yesterday&apos;s Slack messages"'
              rows={2}
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint resize-none"
            />
          </div>

          {/* 2. When */}
          <div>
            <p className="text-sm font-medium mb-1.5">How often?</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(
                [
                  ["daily", "Every day"],
                  ["weekdays", "Weekdays"],
                  ["weekly", "Once a week"],
                  ["monthly", "Once a month"],
                  ["hourly", "Every hour"],
                ] as [Frequency, string][]
              ).map(([f, label]) => (
                <button
                  key={f}
                  onClick={() => setFreq(f)}
                  className={`rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${
                    freq === f
                      ? "bg-accent text-white"
                      : "border border-line bg-transparent text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {freq === "weekly" && (
                <div className="flex gap-1">
                  {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d, i) => (
                    <button
                      key={d}
                      onClick={() => setWeekday(i)}
                      className={`w-9 h-9 rounded-full text-[12px] transition-colors ${
                        weekday === i
                          ? "bg-accent text-white"
                          : "border border-line text-ink-soft hover:border-ink-faint"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}
              {freq === "monthly" && (
                <label className="flex items-center gap-2 text-sm text-ink-soft">
                  On day
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={dayOfMonth}
                    onChange={(e) =>
                      setDayOfMonth(Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))
                    }
                    className="w-16 rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-ink-faint"
                  />
                </label>
              )}
              {freq !== "hourly" && (
                <label className="flex items-center gap-2 text-sm text-ink-soft">
                  At
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-sm outline-none focus:border-ink-faint"
                  />
                </label>
              )}
            </div>

            <p className="mt-3 text-[13px] text-accent font-medium">
              ✓ Runs {describeCron(schedule).toLowerCase()}
            </p>
          </div>

          {/* 3. Optional details */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              className="flex-1 min-w-40 rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
            />
            <button
              onClick={() => setAdvanced(!advanced)}
              className={`flex items-center gap-1.5 text-[12px] transition-colors ${
                advanced ? "text-accent" : "text-ink-faint hover:text-ink-soft"
              }`}
              title="Enter a raw cron expression"
            >
              <Settings2 size={13} />
              Advanced
            </button>
          </div>
          {advanced && (
            <input
              value={rawSchedule}
              onChange={(e) => setRawSchedule(e.target.value)}
              placeholder={`Raw cron expression (currently: ${schedule})`}
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm font-mono outline-none focus:border-ink-faint"
            />
          )}

          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={busy === "new" || !prompt.trim()}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Create task
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg px-3.5 py-1.5 text-sm text-ink-soft hover:bg-parchment-dark"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-sm text-ink-faint">Loading tasks…</p>}
      {error && (
        <p className="text-sm text-red-500 mb-4">{error} — is the Hermes gateway running?</p>
      )}

      <div className="space-y-3">
        {jobs.map((j) => (
          <div
            key={j.id}
            className={`rounded-xl border border-line bg-card px-5 py-4 ${
              j.enabled ? "" : "opacity-60"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[15px] font-medium mb-1">{j.name}</h2>
                {j.prompt && <p className="text-sm text-ink-soft mb-2">{j.prompt}</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-faint">
                  {j.schedule && (
                    <span className="inline-flex items-center gap-1" title={j.schedule}>
                      <Clock size={11} />
                      {describeCron(j.schedule)}
                    </span>
                  )}
                  {j.lastRunAt && <span>last run {timeAgo(j.lastRunAt)}</span>}
                  {j.lastStatus && <span>status: {j.lastStatus}</span>}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() =>
                    act(j.id, () => api.post(`/api/cron/${encodeURIComponent(j.id)}/run`))
                  }
                  disabled={busy === j.id}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                  title="Run now"
                >
                  <Zap size={14} />
                </button>
                <button
                  onClick={() =>
                    act(j.id, () =>
                      api.post(
                        `/api/cron/${encodeURIComponent(j.id)}/${j.enabled ? "pause" : "resume"}`
                      )
                    )
                  }
                  disabled={busy === j.id}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                  title={j.enabled ? "Pause" : "Resume"}
                >
                  {j.enabled ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  onClick={() => act(j.id, () => api.del(`/api/cron/${encodeURIComponent(j.id)}`))}
                  disabled={busy === j.id}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-faint hover:text-red-500"
                  title="Delete job"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!loading && !error && jobs.length === 0 && (
          <p className="text-sm text-ink-faint">
            Nothing scheduled yet. Create a task to get started.
          </p>
        )}
      </div>
    </div>
  );
}
