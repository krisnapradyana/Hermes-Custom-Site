"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

/**
 * Member Directory (alpha) — standalone sub-app, served bare (no sidebar)
 * via PublicRouteSwitch and exposed on its own subdomain through Caddy,
 * exactly like the clock. Access: leadership types + ADMIN_SLACK_IDS —
 * everyone else gets the locked screen. Same design language as the app:
 * canvas gradient / dark aurora, liquid glass, ui-pop motion.
 */

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

interface Member {
  id: string;
  name: string;
  type: string;
  primaryRole: string;
  secondaryRoles: string[];
  capabilities: string[];
  trajectory?: string;
  employment?: string;
  location?: string;
  slackId?: string;
  updatedAt: string;
}

interface SlackUser {
  id: string;
  name: string;
}

/** Display-only mirror of the server gate (lib/members-store canEditDirectory). */
function isLeadershipType(type: string): boolean {
  const t = type.toLowerCase();
  return (
    t.includes("core leadership") ||
    t.includes("creative leadership") ||
    t.includes("production leadership") ||
    t.includes("creative technolog")
  );
}

const EMPTY_FORM = {
  name: "",
  type: "",
  primaryRole: "",
  secondaryRoles: "",
  capabilities: "",
  trajectory: "",
  employment: "",
  location: "",
  slackId: "",
};
type FormState = typeof EMPTY_FORM;

function memberToForm(m: Member): FormState {
  return {
    name: m.name,
    type: m.type,
    primaryRole: m.primaryRole,
    secondaryRoles: m.secondaryRoles.join("\n"),
    capabilities: m.capabilities.join("\n"),
    trajectory: m.trajectory ?? "",
    employment: m.employment ?? "",
    location: m.location ?? "",
    slackId: m.slackId ?? "",
  };
}

function formToPayload(f: FormState) {
  const lines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  return {
    name: f.name,
    type: f.type,
    primaryRole: f.primaryRole,
    secondaryRoles: lines(f.secondaryRoles),
    capabilities: lines(f.capabilities),
    trajectory: f.trajectory,
    employment: f.employment,
    location: f.location,
    slackId: f.slackId,
  };
}

export default function DirectoryPage() {
  return (
    <>
      <div className="app-canvas fixed inset-0 -z-10" aria-hidden />
      <SignInGate>
        <Directory />
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
        <div className="glass-ice anim-pop-center rounded-2xl p-8 flex flex-col items-center max-w-sm text-center">
          <Wordmark />
          <p className="mt-4 mb-6 text-sm text-ink-soft">
            Sign in with your SuperPixel Slack account to continue.
          </p>
          <button
            onClick={() => signIn("slack")}
            className="rounded-xl bg-accent px-5 py-2.5 text-white font-medium hover:bg-accent-hover transition-colors"
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
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl glass">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-ink-soft" aria-hidden>
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">This area is restricted</h1>
        <p className="mt-3 max-w-md text-ink-soft">
          The Member Directory is available to SuperPixel leadership only.
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

type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "register" };

function Directory() {
  const { data: session } = useSession();
  const [me, setMe] = useState<{ allowed: boolean; name: string } | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [slackUsers, setSlackUsers] = useState<SlackUser[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
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

  const loadMembers = useCallback(async () => {
    const res = await fetch("/api/directory/members");
    if (res.ok) setMembers((await res.json()).members as Member[]);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/directory/me");
      if (!res.ok) {
        setMe({ allowed: false, name: session?.user?.name ?? "you" });
        return;
      }
      const data = await res.json();
      setMe({ allowed: data.allowed, name: data.name });
      if (data.allowed) {
        loadMembers();
        fetch("/api/directory/slack-users")
          .then((r) => (r.ok ? r.json() : { users: [] }))
          .then((d) => setSlackUsers(d.users ?? []))
          .catch(() => {});
      }
    })();
  }, [loadMembers, session?.user?.name]);

  const types = useMemo(
    () => Array.from(new Set((members ?? []).map((m) => m.type))).sort(),
    [members]
  );

  const filtered = useMemo(() => {
    if (!members) return [];
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (typeFilter && m.type !== typeFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q) ||
        m.primaryRole.toLowerCase().includes(q) ||
        m.secondaryRoles.some((r) => r.toLowerCase().includes(q)) ||
        m.capabilities.some((c) => c.toLowerCase().includes(q))
      );
    });
  }, [members, query, typeFilter]);

  if (!me) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-ink-faint">Loading…</div>
    );
  }
  if (!me.allowed) return <LockedScreen name={me.name} />;

  const selected =
    view.kind === "detail" ? members?.find((m) => m.id === view.id) ?? null : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-5 md:px-6">
      {/* Header */}
      <header className="glass anim-slide flex items-center gap-3 rounded-2xl px-4 py-3">
        <Wordmark />
        <span className="ml-auto hidden text-xs text-ink-faint sm:block">{me.name}</span>
        <button
          onClick={toggleTheme}
          className="rounded-full p-2 text-ink-soft hover:bg-parchment-dark/60 transition-colors"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      {/* Toolbar */}
      {view.kind === "list" && (
        <div className="mt-4 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, role or capability…"
              className="glass-panel w-full rounded-xl border border-line/50 px-3.5 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
            />
            <button
              onClick={() => setView({ kind: "register" })}
              className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              + Register
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <TypeChip label="All" active={!typeFilter} onClick={() => setTypeFilter(null)} />
            {types.map((t) => (
              <TypeChip
                key={t}
                label={t}
                active={typeFilter === t}
                onClick={() => setTypeFilter(typeFilter === t ? null : t)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <main className="mt-4 flex-1 pb-8">
        {view.kind === "list" &&
          (members === null ? (
            <p className="mt-10 text-center text-sm text-ink-faint">Loading members…</p>
          ) : (
            <div key={`${query}|${typeFilter}`} className="anim-pop grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setView({ kind: "detail", id: m.id })}
                  className="glass-panel rounded-2xl border border-line/50 p-4 text-left transition-colors hover:border-accent/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold">{m.name}</span>
                    {m.slackId ? (
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                        title={`Slack linked (${m.slackId})`}
                      />
                    ) : (
                      <span
                        className="mt-1 h-2 w-2 shrink-0 rounded-full bg-line"
                        title="Slack not linked"
                      />
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-soft">{m.primaryRole}</p>
                  <span
                    className={`mt-2.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      isLeadershipType(m.type)
                        ? "bg-accent-soft text-accent"
                        : "bg-parchment-dark/80 text-ink-soft"
                    }`}
                  >
                    {m.type}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="col-span-full mt-10 text-center text-sm text-ink-faint">
                  No members match.
                </p>
              )}
            </div>
          ))}

        {view.kind === "detail" && selected && (
          <MemberDetail
            key={selected.id}
            member={selected}
            types={types}
            slackUsers={slackUsers}
            onBack={() => setView({ kind: "list" })}
            onSaved={async () => {
              await loadMembers();
            }}
            onDeleted={async () => {
              await loadMembers();
              setView({ kind: "list" });
            }}
          />
        )}

        {view.kind === "register" && (
          <MemberForm
            title="Register member"
            initial={EMPTY_FORM}
            types={types}
            slackUsers={slackUsers}
            submitLabel="Register"
            onCancel={() => setView({ kind: "list" })}
            onSubmit={async (form) => {
              const res = await fetch("/api/directory/members", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formToPayload(form)),
              });
              if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
              await loadMembers();
              setView({ kind: "list" });
            }}
          />
        )}
      </main>

      <footer className="pb-4 text-center text-[11px] text-ink-faint">
        Member Directory · alpha ·{" "}
        <a href="https://spx-assistant.duckdns.org" className="underline hover:text-ink-soft">
          SuperPixel Assistant
        </a>
      </footer>
    </div>
  );
}

/* ---------------- detail / edit ---------------- */

function MemberDetail({
  member,
  types,
  slackUsers,
  onBack,
  onSaved,
  onDeleted,
}: {
  member: Member;
  types: string[];
  slackUsers: SlackUser[];
  onBack: () => void;
  onSaved: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const slackName = slackUsers.find((u) => u.id === member.slackId)?.name;

  if (editing) {
    return (
      <MemberForm
        title={`Edit — ${member.name}`}
        initial={memberToForm(member)}
        types={types}
        slackUsers={slackUsers}
        submitLabel="Save changes"
        onCancel={() => setEditing(false)}
        onSubmit={async (form) => {
          const res = await fetch(`/api/directory/members/${member.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formToPayload(form)),
          });
          if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
          await onSaved();
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="anim-pop mx-auto max-w-2xl">
      <button onClick={onBack} className="mb-3 text-sm text-ink-soft hover:text-ink transition-colors">
        ← All members
      </button>
      <div className="glass-panel rounded-2xl border border-line/50 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{member.name}</h2>
            <p className="mt-0.5 text-ink-soft">{member.primaryRole}</p>
            <span
              className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isLeadershipType(member.type)
                  ? "bg-accent-soft text-accent"
                  : "bg-parchment-dark/80 text-ink-soft"
              }`}
            >
              {member.type}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-xl border border-line px-3.5 py-2 text-sm text-ink-soft hover:text-red-500 hover:border-red-400 transition-colors"
            >
              Remove
            </button>
          </div>
        </div>

        {confirmDelete && (
          <div className="glass-ice anim-pop mt-4 rounded-xl border-[1.5px] border-red-400 p-3.5 text-sm">
            <p className="font-medium">Remove {member.name} from the directory?</p>
            <p className="mt-0.5 text-ink-soft">This can&apos;t be undone.</p>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={async () => {
                  await fetch(`/api/directory/members/${member.id}`, { method: "DELETE" });
                  await onDeleted();
                }}
                className="rounded-lg bg-red-500 px-3 py-1.5 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Remove
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-soft"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <dl className="mt-5 space-y-4 text-sm">
          {member.secondaryRoles.length > 0 && (
            <Field label="Secondary roles">
              <ChipList items={member.secondaryRoles} />
            </Field>
          )}
          {member.capabilities.length > 0 && (
            <Field label="Capabilities">
              <ChipList items={member.capabilities} />
            </Field>
          )}
          {member.trajectory && <Field label="Trajectory">{member.trajectory}</Field>}
          {member.employment && <Field label="Employment">{member.employment}</Field>}
          {member.location && <Field label="Location">{member.location}</Field>}
          <Field label="Slack account">
            {member.slackId ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {slackName ? `${slackName} (${member.slackId})` : member.slackId}
              </span>
            ) : (
              <span className="text-ink-faint">Not linked — Hermes will match this later, or link it via Edit.</span>
            )}
          </Field>
        </dl>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function ChipList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <span
          key={it}
          className="rounded-full bg-parchment-dark/80 px-2.5 py-1 text-xs text-ink-soft"
        >
          {it}
        </span>
      ))}
    </div>
  );
}

/* ---------------- shared form (register + edit) ---------------- */

function MemberForm({
  title,
  initial,
  types,
  slackUsers,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: FormState;
  types: string[];
  slackUsers: SlackUser[];
  submitLabel: string;
  onSubmit: (form: FormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="anim-pop mx-auto max-w-2xl">
      <button onClick={onCancel} className="mb-3 text-sm text-ink-soft hover:text-ink transition-colors">
        ← Back
      </button>
      <form
        className="glass-panel rounded-2xl border border-line/50 p-5 md:p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            await onSubmit(form);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>

        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Input label="Name *" value={form.name} onChange={set("name")} required />
          <div>
            <Label>Type *</Label>
            <input
              value={form.type}
              onChange={(e) => set("type")(e.target.value)}
              list="directory-types"
              required
              placeholder="e.g. Creative Leadership"
              className={inputCls}
            />
            <datalist id="directory-types">
              {types.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            {isLeadershipType(form.type) && (
              <p className="mt-1 text-[11px] text-accent">
                This type can access the directory.
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Input label="Primary role *" value={form.primaryRole} onChange={set("primaryRole")} required />
          </div>
          <Textarea
            label="Secondary roles (one per line)"
            value={form.secondaryRoles}
            onChange={set("secondaryRoles")}
          />
          <Textarea
            label="Capabilities (one per line)"
            value={form.capabilities}
            onChange={set("capabilities")}
          />
          <Input label="Trajectory" value={form.trajectory} onChange={set("trajectory")} />
          <Input label="Employment" value={form.employment} onChange={set("employment")} />
          <Input label="Location" value={form.location} onChange={set("location")} />
          <div>
            <Label>Slack account</Label>
            {slackUsers.length > 0 ? (
              <select
                value={form.slackId}
                onChange={(e) => set("slackId")(e.target.value)}
                className={inputCls}
              >
                <option value="">Not linked</option>
                {slackUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={form.slackId}
                onChange={(e) => set("slackId")(e.target.value)}
                placeholder="Slack member id (e.g. U012ABC3DE)"
                className={inputCls}
              />
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {busy ? "Saving…" : submitLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-line px-4 py-2.5 text-sm text-ink-soft hover:text-ink transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-line bg-card/70 px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
      {children}
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={inputCls}
      />
    </div>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className={`${inputCls} resize-y`}
      />
    </div>
  );
}

/* ---------------- chrome bits ---------------- */

function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-accent text-white"
          : "glass-panel border border-line/50 text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

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
      <span className="ml-1.5 text-[13px] font-medium text-ink-faint">Directory</span>
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
