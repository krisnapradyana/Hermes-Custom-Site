# Build prompt — Project Timeclock (clock in / clock out + manpower view)

> Execution prompt for SuperPixel Assistant. Hand this file to the assistant and
> say "execute the timeclock prompt". Everything below is decided; don't
> re-ask unless something conflicts with the current codebase.

## ARCHITECTURE UPDATE (2026-08-18) — two apps

The member surface is now a SEPARATE app: **Attendee UI** at
`E:\Projects\Hermes-Custom-Attendee-UI`, served on its OWN SUBDOMAIN
(`clock.<domain>` — DuckDNS resolves sub-subdomains to the same IP; Caddy
routes by hostname with its own cert). No basePath.

- **Attendee UI owns the timeclock data and API** (its own volume). Our
  `withLock` mutex is in-process only, so exactly one app may write sessions —
  single-writer principle.
- Same Slack OIDC app, extra redirect URI
  `https://clock.<domain>/api/auth/callback/slack`; cookies carry an
  "attendee." prefix (host-scoped anyway on the subdomain).
- The main app's "Team" tab reads sessions server-to-server from the Attendee
  UI container (internal Docker network + `INTERNAL_TOKEN` header).
- The Attendee UI gets the project list from the main app via
  `GET /api/internal/projects` (same token) — main app remains the single
  writer of `projects.json`.

Everything below still applies; "member surface `/clock`" = the Attendee UI
app, "Team tab" = the main app.

## Goal

Artists clock in when they start working on a project and clock out when they
stop. The system records per-member work sessions per project so (a) managers
can see who is working on what right now and how loaded each person is, and
(b) later, the agent can reason about team workload. Two surfaces:

1. **`/clock` — member surface.** A fast, mobile-first page reachable from the
   sidebar and shareable as a direct link (e.g. pinned in Slack). One glance =
   my current status; one tap = clock in or out.
2. **Project detail → new "Team" tab — manager surface.** Who's on this
   project, who's active right now, hours today / this week per member,
   session history.

## Constraints (must match the existing app)

- Next.js 15 App Router, TypeScript strict, Tailwind v4 with the existing
  tokens: `bg-parchment`, `bg-parchment-dark`, `bg-card`, `border-line`,
  `text-ink / -soft / -faint`, `accent / accent-hover / accent-soft`.
  Cards are `rounded-xl border border-line bg-card`; toolbars are pill-shaped;
  icons are lucide, 13–16px.
- Identity comes from the Slack session: `requireUser()` per route (server),
  session user name/slackId for display. No new auth.
- Storage follows the house pattern: JSON files under `DATA_DIR`, written with
  `withLock` + atomic tmp/rename. **No database.** Files:
  `data/timeclock/<projectId>.json` — array of sessions
  `{ id, userKey, name, slackId?, inAt, outAt: string|null, autoClosed?: true }`.
- All client fetches through `lib/api.ts`. New endpoints under
  `/api/timeclock/*`, auth-gated by the middleware matcher as-is.
- `prefetch={false}` on any new `<Link>` (router-cache bug workaround).

## Rules (product decisions — final)

- **One active session per user, globally.** Clocking in while a session is
  open on another project shows: "You're clocked in on <project>. Switch?" —
  confirming clocks out there and in here atomically.
- Clock-out button always reachable from `/clock` regardless of project.
- **Forgotten sessions auto-close after 12h** (server-side, lazily on next
  read), flagged `autoClosed: true`; UI shows these with an amber "auto-closed"
  chip so managers know the duration is unreliable.
- Members see their own history; the **Team tab is visible to everyone** on the
  project (studio is 20 people — transparency over gatekeeping), but only the
  session owner can delete their own mistaken session (within 24h).
- Times are stored ISO UTC, displayed in the viewer's local timezone.
- No idle detection, no screenshots, no minute-level policing. This measures
  workload, not surveillance. Keep the tone of copy friendly ("You're on
  Honda Promotion — 2h 15m today").

## Member UX — `/clock`

- Header: "Clock" + current local time, live.
- **State A (clocked out):** big accent button per project card — the user's
  projects sorted by most recently worked. Tap = clocked in, card flips to
  active state. Sub-line per card: "3h 20m this week".
- **State B (clocked in):** the active project card dominates (accent border,
  soft glow): project name, live elapsed timer (h:mm:ss), big "Clock out"
  button. Other projects dimmed with "Switch here" secondary action.
- A slim status strip also appears in the app's StatusBar when clocked in:
  `● On <project> · 1h 12m` — links to `/clock`. (Poll the same endpoint the
  StatusBar already polls patterns from; visibility-gated, 30s.)
- Optimistic UI: button state flips immediately; on API failure it reverts
  with the error in place.
- Mobile-first layout (the team will use phones): single column, buttons
  ≥ 48px tall, timer readable at arm's length.

## Manager UX — project detail "Team" tab

- Tab strip gains "Team" after Attachments/Artifacts.
- Top row: **Active now** — avatar-less name chips with green pulse dot and
  live elapsed time (reuse the pulse pattern from the projects page).
- **This week table:** one row per member: name · hours today · hours this
  week · sessions count · last seen. Sortable by hours. A thin inline bar
  (div-width percentage, `bg-accent`) visualizes relative load — no chart
  library.
- **History:** reverse-chronological session list (member, in, out, duration,
  auto-closed chip when applicable), grouped by day, capped at the last 30
  days. "Export CSV" button → `/api/timeclock/<projectId>/export` (plain CSV
  download, all sessions).
- Empty state: "No one has clocked in yet — share the clock link" with a
  copy-link button for `/clock`.

## API

- `GET  /api/timeclock/me` → `{ active: {projectId, inAt} | null, week: {projectId, ms}[] }`
- `POST /api/timeclock/in` `{ projectId }` → clocks in (409 with current
  session info if active elsewhere; `{ switch: true }` forces the swap).
- `POST /api/timeclock/out` → closes the caller's active session.
- `GET  /api/timeclock/[projectId]` → sessions + per-member weekly aggregates
  (server computes; client never sums raw sessions for the table).
- `DELETE /api/timeclock/[projectId]/[sessionId]` → owner-only, < 24h old.
- `GET  /api/timeclock/[projectId]/export` → CSV.
- Lazy auto-close runs inside every read path (no cron dependency —
  Scheduler is disabled).

## PHASE 2 (built 2026-08-18) — Team Pulse + Tasks

Goal: the PM sees at a glance who is busy / who is not, and assigns tasks so
iteration is smooth.

- **Team Pulse** — main app `/team` (sidebar "Team"): working members first
  (green pulse, project, since HH:MM), idle members with last-seen; hours
  today + this week per person; per-project weekly load bar. Data:
  `GET /api/timeclock/overview` on the Attendee UI (internal token), bridged
  by main-app `GET /api/team` (5s cache; `TIMECLOCK_URL` env, default
  `http://attendee-ui:3000`).
- **Tasks** — owned by the MAIN app (`data/tasks/<projectId>.json`,
  `lib/tasks-store.ts`). Lifecycle `todo → doing → review → revision → done`;
  review→revision carries a feedback note stored on the task. Permissions:
  anyone signed in creates/assigns; only assignee or creator changes status
  or deletes. UI: "Tasks" tab in project detail (create + phase + assignee
  picker fed by /api/team members).
- **Clock app integration** — `/api/timeclock/me` also returns my open tasks
  (via main-app internal API `GET /api/internal/tasks?assignee=` and
  `POST /api/internal/tasks/status`). UI: "My tasks" list; Start = clock into
  the task's project + mark doing (survives the switch-confirm flow);
  "To review" hands it to the PM; revision feedback shows on the task.
- Phases available on tasks: Styleframes, Storyboard, Animatic, Animation,
  Render, Revisions, On-site, Other — the motion/immersive pipeline.

## Out of scope for v1 (note in code comments, don't build)

- Per-role permissions / manager allowlist (project `createdBy` field exists
  when we want it).
- Feeding workload summaries into PROJECT-TRACKER.md for the agent.
- Editing session times retroactively; payroll math; overtime rules.

## Acceptance checklist

- [ ] Clock in on phone-sized viewport in ≤ 2 taps from `/clock`.
- [ ] Switching projects produces exactly one closed + one open session.
- [ ] Two rapid clock-in clicks create ONE session (server idempotent).
- [ ] Session left open 12h+ shows auto-closed chip in Team tab.
- [ ] Team tab totals match the raw sessions in the JSON file.
- [ ] CSV opens in Google Sheets with correct local-time columns.
- [ ] `tsc --noEmit`, `eslint --max-warnings 0`, `next build` all clean.
- [ ] No new `<Link>` without `prefetch={false}`.
