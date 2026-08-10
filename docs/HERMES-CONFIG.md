# Hermes container — required settings (learned the hard way)

Settings the agent container needs that are NOT defaults. If the agent
misbehaves after an image update or rebuild, check these first.

## 1. Write access to the Drive mount

The Hermes image ships with `HERMES_WRITE_SAFE_ROOT=/opt/data` baked in,
which blocks all agent file writes outside `/opt/data` — including project
folders on `/gdrive`. Symptom: `Write denied: ... is outside
HERMES_WRITE_SAFE_ROOT`, followed by the agent attempting slow terminal
workarounds and the turn timing out.

Override in `docker-compose.yaml` on the **hermes** service:

```yaml
    environment:
      - HERMES_WRITE_SAFE_ROOT=/opt/data:/gdrive
```

Apply with `docker compose up -d hermes` (a plain `restart` does NOT reload
compose environment).

## 2. /opt/data layout and ownership

`/opt/data` is the `hermes-data` NAMED volume (never `docker compose down -v`).
Inside it:

- `outputs/`  — deliverables from private chats (the web UI turns their paths
  into download buttons). If writes fail with `Permission denied`, re-run:
  `docker exec -u root hermes-local-agent chmod -R u+rwX /opt/data/outputs`
- `scripts/`  — the agent's one-off Python tools
- everything else — Hermes internals; do not reorganize (see the incident
  where moving them reset the agent).

## 3. The three project-knowledge files

| File | Writer | Purpose |
|---|---|---|
| `/gdrive/SUPERPIXEL/PROJECT-TRACKER.md` | web app (auto) | Index of all web-created projects. Regenerated on every change — the agent must never write it. |
| `/gdrive/SUPERPIXEL/PAST-PROJECTS.md` | agent (on request) | Historical archive of pre-web projects, catalogued from the Drive year folders. |
| `/opt/data/project-notes.md` | agent (freely) | The agent's own accumulated project learnings — its "project memory". |

The web app's proxy injects these roles into every agent message
(`src/app/api/hermes/route.ts`), so the division of labour survives
memory resets.

## 4. Toolsets

`agent.disabled_toolsets` in `/opt/data/config.yaml` (the file Hermes reads —
NOT the host `config.yaml`, which is mounted as `custom-config.yaml` and not
merged): browser, spotify, homeassistant, video_gen, computer_use are
disabled (~6% prompt-prefix saving; browser tools unused via web UI).
