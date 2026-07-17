# Team Testing via ngrok — Setup Guide

Expose the locally-running SuperPixel Assistant to your team over the
internet, with working Slack login. Takes ~10 minutes the first time.

## Prerequisites

- ngrok installed and logged in (`ngrok config add-authtoken <token>`)
- Hermes gateway running on this machine (`hermes gateway`)
- Slack app admin access (https://api.slack.com/apps)

## One-time: claim a static ngrok domain (recommended)

Free ngrok URLs are random and change on every restart, which means
re-editing config and the Slack app every session. Avoid that:

1. Go to https://dashboard.ngrok.com → Domains → create your free static
   domain (each account gets one), e.g. `superpixel-test.ngrok-free.app`.
2. Use it below and everything stays permanent between sessions.

## Steps per test session

### 1. Start the app (plain HTTP — ngrok provides the HTTPS)

```powershell
npm run dev
```

Do NOT use `dev:https` — ngrok terminates TLS itself, no self-signed
certificates needed.

### 2. Start the tunnel

```powershell
# with a static domain:
ngrok http --url=superpixel-test.ngrok-free.app 3000

# or with a random URL (note what it prints):
ngrok http 3000
```

### 3. Edit `.env.local` in the project root

```env
NEXT_PUBLIC_AUTH_ENABLED=true
AUTH_URL=https://superpixel-test.ngrok-free.app
```

- `AUTH_URL` — the single place the Slack callback URL comes from.
- "Open file" behavior is automatic per user: browsers on the host
  machine (via localhost) shell-open with the default app; teammates'
  browsers receive the file over HTTP and open it with THEIR own apps.

Restart `npm run dev` after editing (env is read at startup).

### 4. Add the redirect URL in the Slack app

https://api.slack.com/apps → your app → **OAuth & Permissions** →
Redirect URLs → Add:

```
https://superpixel-test.ngrok-free.app/api/auth/callback/slack
```

Keep the existing `https://localhost:3000/...` entry too. Click **Save URLs**.

### 5. Send the team the ngrok URL

They open it, click through ngrok's one-time "Visit Site" interstitial,
and sign in with Slack. Done.

## After the test session

Revert `.env.local` for solo work on this machine:

```env
AUTH_URL=https://localhost:3000
```

and go back to `npm run dev:https`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Slack error: `redirect_uri did not match` | The URL in step 4 doesn't exactly match `AUTH_URL` + `/api/auth/callback/slack`. Check for typos / http vs https. |
| Login bounces to localhost on teammates' devices | `AUTH_URL` still says localhost — step 3 not applied or server not restarted. |
| ngrok URL changed since last session | You're on a random URL — redo steps 3–4, or claim the static domain. |
| Teammates see "ngrok" warning page | Normal on the free tier — click "Visit Site". |
| Replies never arrive for teammates | Hermes gateway not running on the host, or `HERMES_API_URL` misconfigured — check the status bar at the bottom of the app. |

## Security notes

- Never run the tunnel with `NEXT_PUBLIC_AUTH_ENABLED=false` — auth is
  what stands between the internet and your machine's agent.
- The Hermes API key never leaves the server; teammates authenticate with
  Slack only.
- Everyone currently shares ONE agent (same tools, same filesystem).
  Fine for a trusted team test; revisit before wider rollout
  (ROADMAP.md Phase 5: Slack ID allowlist + rate limiting).
