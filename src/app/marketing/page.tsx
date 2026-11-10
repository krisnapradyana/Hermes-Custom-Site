"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { renderMarkdown } from "@/lib/markdown";
import { Radar } from "./Radar";
import { Pipeline } from "./Pipeline";
import { Library } from "./Library";

/**
 * Marketing platform (alpha) — standalone sub-app like the Member Directory:
 * served bare (no sidebar) and exposed on marketing.* through Caddy +
 * middleware. Access comes from the Directory role (lib/marketing-access).
 *
 * Modules: Checker Studio — run the team's own review prompts (landing page
 * copy / SEO article / EDM) over a draft; reviews are not stored. Publish
 * Radar (./Radar) — delivered projects and whether they are safe to post.
 * Content Pipeline (./Pipeline) — one card per angle, idea to published.
 * Library & Rules (./Library) — reference docs, prompts, house rules.
 */

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

interface CheckerField {
  key: string;
  label: string;
  placeholder: string;
}
interface CheckerMeta {
  id: string;
  label: string;
  version: string;
  draftLabel: string;
  fields: CheckerField[];
}
interface Review {
  review: string;
  label: string;
  version: string;
  ranAt: string;
}

const TABS = [
  { id: "checker", label: "Checker Studio", ready: true },
  { id: "radar", label: "Publish Radar", ready: true },
  { id: "pipeline", label: "Content Pipeline", ready: true },
  { id: "library", label: "Library & Rules", ready: true },
] as const;

export default function MarketingPage() {
  return (
    <>
      <div className="app-canvas fixed inset-0 -z-10" aria-hidden />
      <SignInGate>
        <Marketing />
      </SignInGate>
    </>
  );
}

/* ---------------- auth + access gates ---------------- */

function SignInGate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  if (!AUTH_ENABLED) return <>{children}</>;

  if (status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-ink-faint">Loading…</div>
    );
  }
  if (status === "unauthenticated") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center px-6">
        <div className="glass-ice anim-pop-center flex max-w-sm flex-col items-center rounded-2xl p-8 text-center">
          <Wordmark />
          <p className="mb-6 mt-4 text-sm text-ink-soft">
            Sign in with your SuperPixel Slack account to continue.
          </p>
          <button
            onClick={() => signIn("slack")}
            className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Sign in with Slack
          </button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function LockedScreen({ name }: { name: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="anim-pop-center flex flex-col items-center">
        <div className="glass mb-6 flex h-16 w-16 items-center justify-center rounded-2xl">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-soft" aria-hidden>
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">This area is restricted</h1>
        <p className="mt-3 max-w-md text-ink-soft">
          The Marketing platform is available to the marketing team and leadership.
          <br />
          Please contact your administrator if you believe you should have access.
        </p>
        <p className="mt-6 text-xs text-ink-faint">
          Signed in as {name} ·{" "}
          <button onClick={() => signOut()} className="underline hover:text-ink-soft">
            sign out
          </button>
        </p>
      </div>
    </div>
  );
}

/* ---------------- main app ---------------- */

function Marketing() {
  const { data: session } = useSession();
  const [me, setMe] = useState<{ allowed: boolean; name: string } | null>(null);
  const [checkers, setCheckers] = useState<CheckerMeta[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("checker");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("hermes-theme", next ? "dark" : "light");
    } catch {
      /* private mode — theme just won't persist */
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/marketing/me");
        if (!res.ok) {
          setMe({ allowed: false, name: session?.user?.name ?? "you" });
          return;
        }
        const data = await res.json();
        setCheckers(data.checkers ?? []);
        setMe({ allowed: data.allowed, name: data.name });
      } catch {
        setMe({ allowed: false, name: session?.user?.name ?? "you" });
      }
    })();
  }, [session?.user?.name]);

  if (!me) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-ink-faint">Loading…</div>
    );
  }
  if (!me.allowed) return <LockedScreen name={me.name} />;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1400px] flex-col px-4 py-5 md:px-8">
      <header className="glass anim-slide flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3">
        <Wordmark />
        <nav className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                tab === t.id
                  ? "bg-accent-soft text-accent"
                  : "text-ink-soft hover:bg-parchment-dark/60"
              }`}
            >
              {t.label}
              {!t.ready && (
                <span className="ml-1.5 rounded-full border border-line/60 px-1.5 py-px text-[10px] font-normal text-ink-faint">
                  soon
                </span>
              )}
            </button>
          ))}
        </nav>
        <span className="ml-auto hidden text-xs text-ink-faint sm:block">{me.name}</span>
        <button
          onClick={toggleTheme}
          className="rounded-full p-2 text-ink-soft transition-colors hover:bg-parchment-dark/60"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      <main className="mt-5 flex-1 pb-8">
        {tab === "checker" ? (
          <CheckerStudio checkers={checkers} />
        ) : tab === "radar" ? (
          <Radar />
        ) : tab === "pipeline" ? (
          <Pipeline />
        ) : (
          <Library />
        )}
      </main>
    </div>
  );
}

/* ---------------- Checker Studio ---------------- */

function CheckerStudio({ checkers }: { checkers: CheckerMeta[] }) {
  const [type, setType] = useState(checkers[0]?.id ?? "");
  // Context + draft are kept per checker so switching type loses nothing.
  const [context, setContext] = useState<Record<string, Record<string, string>>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Review | null>(null);
  const [copied, setCopied] = useState(false);
  const outRef = useRef<HTMLDivElement>(null);

  const checker = checkers.find((c) => c.id === type);
  const draft = drafts[type] ?? "";
  const words = useMemo(() => (draft.trim() ? draft.trim().split(/\s+/).length : 0), [draft]);

  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  if (!checker) {
    return <p className="mt-10 text-center text-sm text-ink-faint">No checkers configured.</p>;
  }

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/marketing/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, draft, context: context[type] ?? {} }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
      } else {
        setResult(data as Review);
        setCopied(false);
        requestAnimationFrame(() =>
          outRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        );
      }
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.review);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can select the text */
    }
  };

  const inputCls =
    "w-full rounded-xl border border-line/60 bg-card/70 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent";

  return (
    <div className="anim-pop">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 11l3 3 8-8" />
            <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
          </svg>
        </span>
        <div>
          <h1 className="font-serif-display text-3xl leading-none">Checker Studio</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Run the team&apos;s review prompt on a draft before it goes to a human reviewer.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        {/* ---- input ---- */}
        <section className="glass-panel rounded-2xl border border-line/50 p-5">
          <Label>Deliverable</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {checkers.map((c) => (
              <button
                key={c.id}
                onClick={() => setType(c.id)}
                className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                  c.id === type
                    ? "border-accent bg-accent-soft font-medium text-accent"
                    : "border-line/60 text-ink-soft hover:bg-parchment-dark/60"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {checker.fields.length > 0 && (
            <div className="mt-5">
              <Label>
                Context <span className="font-normal normal-case text-ink-faint">— optional, but the review is sharper with it</span>
              </Label>
              <div className="mt-1.5 flex flex-col gap-2">
                {checker.fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 block text-xs text-ink-soft">{f.label}</span>
                    <input
                      value={context[type]?.[f.key] ?? ""}
                      onChange={(e) =>
                        setContext((c) => ({
                          ...c,
                          [type]: { ...(c[type] ?? {}), [f.key]: e.target.value },
                        }))
                      }
                      placeholder={f.placeholder}
                      className={inputCls}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <Label>Draft</Label>
              <span className="text-xs text-ink-faint">{words.toLocaleString()} words</span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDrafts((d) => ({ ...d, [type]: e.target.value }))}
              placeholder="Paste the full draft here…"
              rows={14}
              className={`${inputCls} mt-1.5 resize-y leading-relaxed`}
            />
          </div>

          {error && (
            <p className="mt-3 rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={run}
              disabled={busy || draft.trim().length < 40}
              className="rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? `Reviewing… ${elapsed}s` : "Run checker"}
            </button>
            <span className="text-xs text-ink-faint">
              {busy ? "Usually 1–3 minutes. Keep this tab open." : `Prompt ${checker.version}`}
            </span>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
            The draft is sent to the studio&apos;s AI model for this review and is not saved here.
            A pass from the checker is a first filter, not sign-off.
          </p>
        </section>

        {/* ---- output ---- */}
        <section
          ref={outRef}
          className="glass-panel min-h-[420px] scroll-mt-4 rounded-2xl border border-line/50 p-5"
        >
          {result ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line/50 pb-3">
                <span className="text-sm font-medium">{result.label}</span>
                <span className="text-xs text-ink-faint">
                  prompt {result.version} ·{" "}
                  {new Date(result.ranAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <button
                  onClick={copy}
                  className="ml-auto rounded-lg border border-line/60 px-3 py-1.5 text-xs text-ink-soft transition-colors hover:bg-parchment-dark/60"
                >
                  {copied ? "Copied" : "Copy review"}
                </button>
              </div>
              <div
                className="md-body text-[14px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(result.review) }}
              />
            </>
          ) : (
            <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
              <p className="text-sm text-ink-soft">
                {busy ? "Reading the draft against every check…" : "The review appears here."}
              </p>
              {!busy && (
                <p className="mt-1 max-w-sm text-xs text-ink-faint">
                  Pick the deliverable, paste the draft, run. Copy the result into Slack or the
                  doc when you hand it over.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{children}</div>
  );
}

/* ---------------- bits ---------------- */

function Wordmark() {
  return (
    <span className="select-none whitespace-nowrap text-[17px] font-extrabold tracking-tight text-[#2b2b2b] dark:text-ink">
      SuperPi
      <svg
        viewBox="0 0 3 3"
        className="mx-px inline h-[0.545em] w-[0.545em] align-baseline"
        fill="currentColor"
        aria-hidden
      >
        <rect x="0" y="0" width="1" height="1" />
        <rect x="2" y="0" width="1" height="1" />
        <rect x="1" y="1" width="1" height="1" />
        <rect x="0" y="2" width="1" height="1" />
        <rect x="2" y="2" width="1" height="1" />
      </svg>
      el
      <span className="ml-1.5 text-[13px] font-medium text-ink-faint">Marketing</span>
    </span>
  );
}

function SunIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.3 11.3 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}
