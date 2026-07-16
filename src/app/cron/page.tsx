"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Clock, Play, Pause, RefreshCw, Zap } from "lucide-react";
import { describeCron, timeAgo } from "@/lib/format";

/**
 * Phase 4a: this page reflects the agent's REAL scheduled jobs via
 * Hermes' /api/jobs (proxied at /api/cron) — the same jobs `hermes cron`
 * manages, including ones created from Slack or the CLI.
 */

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
    : ((data as Record<string, unknown>)?.jobs as unknown[]) ??
      ((data as Record<string, unknown>)?.data as unknown[]) ??
      [];
  return (list as Record<string, unknown>[]).map(mapJob);
}

export default function CronPage() {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("0 7 * * 1-5");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/cron", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Failed to load jobs (${res.status})`);
        setJobs([]);
      } else {
        setJobs(extractJobs(data));
      }
    } catch {
      setError("Could not reach the gateway.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (id: string, doIt: () => Promise<Response>) => {
    setBusy(id);
    try {
      await doIt();
      await refresh();
    } finally {
      setBusy("");
    }
  };

  const create = async () => {
    if (!prompt.trim()) return;
    setBusy("new");
    try {
      await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, schedule, prompt: prompt.trim() }),
      });
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
          <h1 className="font-serif-display text-3xl mb-1">Cron jobs</h1>
          <p className="text-sm text-ink-soft">
            The agent&apos;s real scheduled jobs — shared with Slack and the CLI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
          >
            <Plus size={15} />
            New job
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-8 rounded-xl border border-line bg-card p-5 space-y-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Job name (optional)"
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint"
          />
          <div>
            <input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="Cron expression"
              className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm font-mono outline-none focus:border-ink-faint"
            />
            <p className="mt-1 text-[11px] text-ink-faint">{describeCron(schedule)}</p>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do on each run?"
            rows={2}
            className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink-faint resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={busy === "new"}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Create job
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

      {loading && <p className="text-sm text-ink-faint">Loading jobs…</p>}
      {error && (
        <p className="text-sm text-red-500 mb-4">
          {error} — is the Hermes gateway running?
        </p>
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
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} />
                      <code className="font-mono">{j.schedule}</code> · {describeCron(j.schedule)}
                    </span>
                  )}
                  {j.lastRunAt && <span>last run {timeAgo(j.lastRunAt)}</span>}
                  {j.lastStatus && <span>status: {j.lastStatus}</span>}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() =>
                    act(j.id, () => fetch(`/api/cron/${encodeURIComponent(j.id)}/run`, { method: "POST" }))
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
                      fetch(`/api/cron/${encodeURIComponent(j.id)}/${j.enabled ? "pause" : "resume"}`, {
                        method: "POST",
                      })
                    )
                  }
                  disabled={busy === j.id}
                  className="p-2 rounded-lg hover:bg-parchment-dark text-ink-soft"
                  title={j.enabled ? "Pause" : "Resume"}
                >
                  {j.enabled ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button
                  onClick={() =>
                    act(j.id, () => fetch(`/api/cron/${encodeURIComponent(j.id)}`, { method: "DELETE" }))
                  }
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
          <p className="text-sm text-ink-faint">No scheduled jobs. Create one to get started.</p>
        )}
      </div>
    </div>
  );
}
