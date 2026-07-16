# Roadmap — Slack-scoped user context

Goal: users of the deployed web UI sign in with their Slack account, and the
agent uses (and stores) the same per-person context it already has from Slack.

## Phase 1 — Slack login  ← in progress

- "Sign in with Slack" (OpenID Connect) via Auth.js.
- Gives us `slack_user_id`, name, avatar; session cookie keeps users signed in.
- Gated behind `NEXT_PUBLIC_AUTH_ENABLED` so local dev works without a Slack app.

## Phase 2 — Context binding

- Proxy adds `X-Hermes-Session-Key: slack:dm:<slack_user_id>` on every agent call,
  matching the scope Hermes' Slack bridge uses (verify exact key format against
  the bridge's session keys).
- Per-conversation `X-Hermes-Session-Id`; drop client-side history resending in
  favor of Hermes' server-side conversation state (`/v1/responses` or session chat).

## Phase 3 — Server-side storage

- Replace localStorage with SQLite + Prisma keyed by Slack ID.
- Chats, projects, artifacts, and pins follow the user across devices.

## Phase 4 — Unified history

- Recents pulls Hermes `/api/sessions` so Slack-side conversations appear in the UI.
- Cron page backed by Hermes `/api/jobs` (create/pause/resume/trigger/delete).

## Phase 5 — Multi-user hardening

- The Hermes API key grants full agent access (terminal included) and all web
  users share one agent. Before opening the link beyond a trusted team:
  - Allowlist of Slack user IDs (or per-user Hermes profiles for isolation).
  - Rate limiting on the proxy.
  - HTTPS deployment on a host that supports long-lived SSE (VPS/Docker).
