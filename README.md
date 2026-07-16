# Hermes Interface

Web UI for the headless Hermes agent (the same one connected to Slack). Claude-inspired layout.

## Features (v1)

- Chat window with streaming indicator (mock responses for now)
- Recents & Pinned conversations in the sidebar
- Projects — group conversations and artifacts
- Artifact history with preview (documents, code, HTML, diagrams)
- Cron jobs — scheduled prompts targeting Slack or chat

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Connecting the real Hermes backend

All agent calls go through `src/lib/hermes-api.ts`. Replace `hermesRespond()` with a fetch/SSE call to your Hermes gateway — the UI needs no other changes. Mock data lives in `src/lib/mock-data.ts`; state in `src/lib/store.ts` (Zustand).

## Deploy

Standard Next.js app — deploys to Vercel out of the box, or any Node host / Docker:

```bash
npm run build
npm start
```
