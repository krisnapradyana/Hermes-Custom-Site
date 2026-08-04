# Roadmap — Slack-scoped user context

Goal: users of the deployed web UI sign in with their Slack account, and the
agent uses (and stores) the same per-person context it already has from Slack.

## Phase 1 — Slack login  ✅ done

- "Sign in with Slack" (OpenID Connect) via Auth.js.
- Gives us `slack_user_id`, name, avatar; session cookie keeps users signed in.
- Gated behind `NEXT_PUBLIC_AUTH_ENABLED` so local dev works without a Slack app.

## Phase 2 — Context binding  ✅ done (verify session-key prefix against the Slack bridge)

- Proxy adds `X-Hermes-Session-Key: slack:dm:<slack_user_id>` on every agent call,
  matching the scope Hermes' Slack bridge uses (verify exact key format against
  the bridge's session keys).
- Per-conversation `X-Hermes-Session-Id`; drop client-side history resending in
  favor of Hermes' server-side conversation state (`/v1/responses` or session chat).

## Phase 3 — Server-side storage  ✅ done (architecture updated since)

- Current design: private chats are ONE FILE PER CHAT under `data/chats/<user>/`
  with a metadata index (`src/lib/chats-store.ts`, `/api/chats`); the old
  single-blob `/api/state` now persists only artifacts. Legacy blobs are
  auto-split on first load with a backup kept (`src/lib/chats-migrate.ts`).
- Upgrade path: swap the JSON stores for SQLite/Postgres when scale demands.

## Phase 4 — Unified history  ✅ done

- Cron page backed by Hermes `/api/jobs` (create/pause/resume/run/delete) —
  shows the agent's real scheduled jobs shared with Slack/CLI.
- New "Agent history" page lists Hermes `/api/sessions` with a read-only
  message viewer (includes Slack-side conversations).

## Phase 5 — Multi-user hardening

- The Hermes API key grants full agent access (terminal included) and all web
  users share one agent. Before opening the link beyond a trusted team:
  - Allowlist of Slack user IDs (or per-user Hermes profiles for isolation).
  - Rate limiting on the proxy.
  - HTTPS deployment on a host that supports long-lived SSE (VPS/Docker).
