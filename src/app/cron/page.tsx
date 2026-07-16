"use client";

import { useState } from "react";
import { Plus, Trash2, Clock, Slack, MessageSquare, CheckCircle2, XCircle } from "lucide-react";
import { useHermesStore } from "@/lib/store";
import { timeAgo, describeCron } from "@/lib/format";

export default function CronPage() {
  const jobs = useHermesStore((s) => s.cronJobs);
  const toggleCron = useHermesStore((s) => s.toggleCron);
  const deleteCron = useHermesStore((s) => s.deleteCron);
  const createCron = useHermesStore((s) => s.createCron);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("0 7 * * 1-5");
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState<"chat" | "slack">("slack");

  const submit = () => {
    if (!name.trim() || !prompt.trim()) return;
    createCron({ name: name.trim(), schedule, prompt: prompt.trim(), enabled: true, target });
    setName("");
    setPrompt("");
    setShowForm(false);
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif-display text-3xl mb-1">Cron jobs</h1>
          <p className="text-sm text-ink-soft">
            Prompts Hermes runs on a schedule — digests, reports, monitors.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={15} />
          New job
        </button>
      </div>

      {showForm && (
        <div className="mb-8 rounded-xl border border-line bg-card p-5 space-y-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Job name (e.g. Morning briefing)"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-ink-faint"
          />
          <div className="flex gap-3">
            <div className="flex-1">
              <input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="Cron expression"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm font-mono outline-none focus:border-ink-faint"
              />
              <p className="mt-1 text-[11px] text-ink-faint">{describeCron(schedule)}</p>
            </div>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as "chat" | "slack")}
              className="h-fit rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none"
            >
              <option value="slack">Post to Slack</option>
              <option value="chat">Save as chat</option>
            </select>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should Hermes do on each run?"
            rows={2}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-ink-faint resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              className="rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white hover:bg-accent-hover"
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
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-[15px] font-medium">{j.name}</h2>
                  {j.lastStatus === "success" && (
                    <CheckCircle2 size={14} className="text-green-600" />
                  )}
                  {j.lastStatus === "failed" && <XCircle size={14} className="text-red-500" />}
                </div>
                <p className="text-sm text-ink-soft mb-2">{j.prompt}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-faint">
                  <span className="inline-flex items-center gap-1">
                    <Clock size={11} />
                    <code className="font-mono">{j.schedule}</code> · {describeCron(j.schedule)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    {j.target === "slack" ? <Slack size={11} /> : <MessageSquare size={11} />}
                    {j.target === "slack" ? "Slack" : "Chat"}
                  </span>
                  {j.lastRunAt && <span>last run {timeAgo(j.lastRunAt)}</span>}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Toggle */}
                <button
                  onClick={() => toggleCron(j.id)}
                  className={`relative h-5.5 w-10 rounded-full transition-colors ${
                    j.enabled ? "bg-accent" : "bg-line"
                  }`}
                  title={j.enabled ? "Disable" : "Enable"}
                >
                  <span
                    className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all ${
                      j.enabled ? "left-5" : "left-0.5"
                    }`}
                  />
                </button>
                <button
                  onClick={() => deleteCron(j.id)}
                  className="p-1.5 rounded-lg hover:bg-parchment-dark text-ink-faint hover:text-red-600"
                  title="Delete job"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {jobs.length === 0 && (
          <p className="text-sm text-ink-faint">No scheduled jobs. Create one to get started.</p>
        )}
      </div>
    </div>
  );
}
