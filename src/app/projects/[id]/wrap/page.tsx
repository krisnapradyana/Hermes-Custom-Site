"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Star, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useHermesStore } from "@/lib/store";

/**
 * Wrap-up / post-mortem form — the studio's "Post-Mortem Reflection" Google
 * Form, question-for-question (producers evaluate on the exact same data),
 * minus the parts the platform already knows (name, project).
 *
 * Two modes, same questionnaire:
 *  - WRAP: flagship project not done yet → submitting THIS form is what
 *    marks it done (and invites the involved team to add their reflections).
 *  - REFLECT: project already wrapped → add/revise your own response.
 */

interface PulseLite {
  userKey: string;
  name: string;
  weekByProject: { projectId: string; ms: number }[];
  totalByProject?: { projectId: string; ms: number }[];
  tasks: { projectId: string }[];
}

const RATINGS: { key: RatingKey; label: string }[] = [
  { key: "perception", label: "Your level of perception for this project" },
  { key: "communication", label: "Your communication skill for this project" },
  { key: "speed", label: "Your speed for this project" },
  { key: "creativity", label: "Your creativity for this project" },
  { key: "outcome", label: "Your satisfaction with the overall outcome / final output" },
];
type RatingKey = "perception" | "communication" | "speed" | "creativity" | "outcome";

const fmtH = (ms: number) => {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export default function WrapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const project = useHermesStore((s) => s.projects.find((p) => p.id === id));
  const loadProjects = useHermesStore((s) => s.loadProjects);
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const wrapMode = !!project && !project.doneAt;

  // Involved people (for the stat chip + the invite list on wrap).
  const [pulse, setPulse] = useState<PulseLite[]>([]);
  useEffect(() => {
    api.get<{ members: PulseLite[] }>("/api/team").then((r) => r.ok && setPulse(r.data.members));
  }, []);
  const involved = useMemo(
    () =>
      pulse.filter(
        (m) =>
          (m.totalByProject ?? []).some((w) => w.projectId === id && w.ms > 0) ||
          m.weekByProject.some((w) => w.projectId === id && w.ms > 0) ||
          m.tasks.some((t) => t.projectId === id)
      ),
    [pulse, id]
  );
  const manMs = involved.reduce(
    (acc, m) => acc + ((m.totalByProject ?? []).find((w) => w.projectId === id)?.ms ?? 0),
    0
  );

  // Form state — prefilled with my previous response if I already answered.
  const [involvement, setInvolvement] = useState("");
  const [wentWell, setWentWell] = useState("");
  const [challenges, setChallenges] = useState("");
  const [improvements, setImprovements] = useState("");
  const [ratings, setRatings] = useState<Record<RatingKey, number>>({
    perception: 0,
    communication: 0,
    speed: 0,
    creativity: 0,
    outcome: 0,
  });
  const [invite, setInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    const res = await api.get<{
      myResponse: {
        involvement: string;
        wentWell: string;
        challenges: string;
        improvements: string;
        ratings: Record<RatingKey, number>;
        at: string;
      } | null;
    }>(`/api/projects/${encodeURIComponent(id)}/postmortem`);
    if (res.ok && res.data.myResponse) {
      const m = res.data.myResponse;
      setInvolvement(m.involvement);
      setWentWell(m.wentWell);
      setChallenges(m.challenges);
      setImprovements(m.improvements);
      setRatings(m.ratings);
      setSavedAt(m.at);
    }
  }, [id]);
  useEffect(() => {
    loadMine();
  }, [loadMine]);

  const incomplete =
    !involvement.trim() ||
    !wentWell.trim() ||
    !challenges.trim() ||
    !improvements.trim() ||
    Object.values(ratings).some((v) => v < 1);

  const submit = async () => {
    if (busy || incomplete) return;
    setBusy(true);
    setError("");
    const res = await api.post<{ postmortem: unknown }>(
      `/api/projects/${encodeURIComponent(id)}/postmortem`,
      {
        involvement,
        wentWell,
        challenges,
        improvements,
        ratings,
        wrap: wrapMode,
        invite: wrapMode && invite ? involved.map((m) => m.userKey) : [],
      }
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await loadProjects();
    router.push(`/projects/${encodeURIComponent(id)}`);
  };

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        Project not found.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <Link
        prefetch={false}
        href={`/projects/${encodeURIComponent(id)}`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <ArrowLeft size={14} />
        {project.name}
      </Link>

      {/* Header */}
      <div className="glass-panel mb-3 rounded-2xl border border-line/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <ClipboardCheck size={18} className="text-accent shrink-0" />
          <h1 className="flex-1 min-w-[200px] text-xl font-semibold tracking-tight">
            {wrapMode ? "Wrap up" : "Post-mortem reflection"} — {project.name}
          </h1>
          {project.tags?.includes("flagship") && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-[11.5px] font-medium text-violet-600 dark:text-violet-400">
              <Star size={11} /> Flagship
            </span>
          )}
          {wrapMode ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11.5px] font-medium text-accent">
              In progress → done after submit
            </span>
          ) : (
            <span className="rounded-full bg-green-500/10 px-2.5 py-1 text-[11.5px] font-medium text-green-600 dark:text-green-400">
              Wrapped{project.wrappedBy ? ` by ${project.wrappedBy.name}` : ""}
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[12.5px] text-ink-soft">
          The classic Post-Mortem Reflection, platform-native — your answers become part of this
          project&apos;s permanent wisdom, distilled by Hermes.
          {savedAt && " You answered before — submitting again revises your response."}
        </p>
      </div>

      {/* Prefilled facts */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(project.startDate || project.deadline) && (
          <span className="glass-panel rounded-lg border border-line/50 px-2.5 py-1.5 text-[11.5px] text-ink-soft">
            {project.startDate ?? "?"} → {project.deadline ?? "?"}
          </span>
        )}
        {manMs > 0 && (
          <span className="glass-panel rounded-lg border border-line/50 px-2.5 py-1.5 text-[11.5px] text-ink-soft">
            {fmtH(manMs)} · {involved.length} involved
          </span>
        )}
      </div>

      {/* Q1 — involvement */}
      <Field label="What is your involvement/responsibility in this project? *">
        <input
          value={involvement}
          onChange={(e) => setInvolvement(e.target.value)}
          placeholder="e.g. Producer — client comms, schedule, onsite lead"
          className={inputCls}
        />
      </Field>

      {/* Q2–4 — the three open questions, word-for-word */}
      <Field label="What do you think went well for this project? *">
        <textarea value={wentWell} onChange={(e) => setWentWell(e.target.value)} rows={3} className={inputCls} />
      </Field>
      <Field label="What are the challenges you faced during the process? *">
        <textarea value={challenges} onChange={(e) => setChallenges(e.target.value)} rows={3} className={inputCls} />
      </Field>
      <Field label="What do you think can be improved for this project? *">
        <textarea value={improvements} onChange={(e) => setImprovements(e.target.value)} rows={3} className={inputCls} />
      </Field>

      {/* Ratings — the five scales, original anchors */}
      <div className="glass-panel mb-4 rounded-2xl border border-line/60 px-5 py-4">
        <p className="mb-1 text-[13px] font-medium">Rate yourself, 1–5 *</p>
        <p className="mb-3 text-[11.5px] text-ink-faint">
          1 = does not meet expectation · 5 = far exceeds expectation
        </p>
        <div className="space-y-3">
          {RATINGS.map(({ key, label }) => (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <span className="flex-1 min-w-[220px] text-[12.5px] text-ink-soft">{label}</span>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRatings((r) => ({ ...r, [key]: n }))}
                    className={`h-8 w-8 rounded-lg border text-[13px] font-medium transition-colors ${
                      ratings[key] === n
                        ? "border-accent bg-accent text-white"
                        : "border-line text-ink-soft hover:border-accent/60"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Wrap-only: invite the team */}
      {wrapMode && involved.length > 1 && (
        <label className="mb-4 flex items-start gap-2.5 rounded-xl border border-line bg-card px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={invite}
            onChange={(e) => setInvite(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-[12.5px] text-ink-soft">
            Ask the involved team ({involved.length - 1} other{involved.length - 1 === 1 ? "" : "s"}
            ) to add their reflections — each gets a Slack DM with this form.
          </span>
        </label>
      )}

      {error && <p className="mb-3 text-[13px] text-red-500">{error}</p>}

      <div className="flex items-center gap-2.5">
        <button
          onClick={submit}
          disabled={busy || incomplete}
          className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[13.5px] font-medium text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
        >
          <CheckCircle2 size={15} />
          {busy ? "Submitting…" : wrapMode ? "Submit and mark done" : savedAt ? "Update my reflection" : "Submit reflection"}
        </button>
        {incomplete && (
          <span className="text-[11.5px] text-ink-faint">
            All questions and all five ratings are required — same as the original form.
          </span>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-line bg-card/60 px-3 py-2 text-[13px] outline-none placeholder:text-ink-faint focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[13px] font-medium">{label}</p>
      {children}
    </div>
  );
}
