# SuperPixel Assistant

A multi-user web interface for the [Hermes agent](https://github.com/NousResearch/hermes-agent)
(Nous Research), built for the SuperPixel team. Slack sign-in, shared projects on the company
Google Drive, streaming chat with live tool activity, artifacts, attachments, and a scheduler —
all backed by a self-hosted Hermes instance.

## Architecture

- **Next.js 15 / React 19 / Tailwind 4** app (this repo), deployed as a Docker container.
- **Hermes agent** runs in a sibling container; this app talks to its OpenAI-compatible
  API server (`/v1/chat/completions`, SSE) through the server-side proxy at `src/app/api/hermes`.
- **Auth**: Slack OIDC via next-auth v5. All API routes are walled by `src/middleware.ts`
  plus per-route `requireUser()`.
- **Storage**: JSON files under `DATA_DIR` (Docker volume). Private chats are one file per
  chat (`chats/<user>/`), shared projects and project conversations are global, attachments
  are content-addressed blobs. Google Drive is mounted read/write via rclone at `/gdrive`
  and shared with the agent container; agent output in `/opt/data` is mounted read-only
  so files it generates become download buttons in chat.

## Develop

```bash
npm install
cp .env.example .env.local   # fill in — see comments in the file
npm run dev                  # or dev:https for Slack OAuth testing
```

Quality gates: `npm run typecheck`, `npm run lint`, `npm run format:check`.

## Deploy

See `docs/DEPLOY-REMOTE.md` (Docker + Caddy + DuckDNS) and `docker-compose.example.yml`
(the maintained compose reference). Drive mounting is covered in `docs/DRIVE-RCLONE.md`.

Every deploy: `git pull && docker compose up -d --build assistant-web`.
State lives in Docker volumes — never run `docker compose down -v`.
