# Mounting the Shared Drive on the server (rclone + service account)

Goal: the Hermes agent reads and writes the team's Google **Shared Drive**
directly, so files it generates land in everyone's `G:\` automatically.

## Why a service account (not a login)

A service account is a *robot* Google identity — a key file on the server.
Nobody signs into it, so it can't be "logged out," and it doesn't consume
any person's storage quota. This is the durable fix for "our shared account
can be logged out anytime." No human OAuth token involved.

## How it flows

```
Teammate PC:  G:\...\SUPERPIXEL\RND - PixelLab   (Shared Drive shortcut)
                    ↕  Google Drive for Desktop (already syncing)
Google Shared Drive (cloud)  ← single source of truth
                    ↕  rclone + service account  (NEW, on the server)
Server:       /gdrive/RND - PixelLab
                    ↓
Hermes agent  reads & writes like a normal folder
```

---

## Phase 1 — Create the service account (needs Google Workspace admin)

In Google Cloud Console (console.cloud.google.com), on any project:

1. **Enable the Drive API**: APIs & Services → Library → "Google Drive API" → Enable.
2. **Create a service account**: IAM & Admin → Service Accounts → Create.
   Name it e.g. `hermes-drive`. Skip role grants. Create.
3. **Make a key**: open the service account → Keys → Add key → JSON. A
   `.json` file downloads. This is the credential — treat it like a password.
4. **Give it Shared Drive access**: open the Shared Drive in Google Drive →
   Manage members → add the service account's email
   (`hermes-drive@<project>.iam.gserviceaccount.com`) as **Contributor**.
   Contributor lets the agent CREATE and edit files but **cannot delete or
   move** them (Google enforces this) — the safe level. Use Content manager
   only if you deliberately want the agent able to delete/move.

Copy the JSON key to the server, e.g. `~/Hermes-Agent-Slack/gdrive-sa.json`
(keep it out of git).

## Phase 2 — Configure rclone

```bash
sudo -v ; curl https://rclone.org/install.sh | sudo bash

# Find the Shared Drive's ID (the service account can list them):
rclone backend drives gdrive: 2>/dev/null || true
```

Create `~/.config/rclone/rclone.conf` (or via `rclone config`):

```ini
[gdrive]
type = drive
scope = drive
service_account_file = /home/krisnapradyana/Hermes-Agent-Slack/gdrive-sa.json
team_drive = 0B94M-NC2rvx2Y0EwZUU3emEwNWs
```

`team_drive` is the Shared Drive ID — it's the value from your path
`G:\.shortcut-targets-by-id\0B94M-NC2rvx2Y0EwZUU3emEwNWs\...`. With it set,
the mount root IS the Shared Drive, so `SUPERPIXEL` / `RND - PixelLab` sit
right at the top.

Verify:
```bash
rclone lsd gdrive:
rclone ls "gdrive:RND - PixelLab" | head
```

## Phase 3 — Mount as a service

```bash
sudo mkdir -p /gdrive && sudo chown $USER /gdrive
rclone mount gdrive: /gdrive \
  --vfs-cache-mode full --vfs-cache-max-size 20G --vfs-cache-max-age 24h \
  --dir-cache-time 10s --poll-interval 15s &
ls /gdrive        # should list SUPERPIXEL, RND - PixelLab, etc.
```

Make it permanent (systemd) and enable FUSE `allow_other` — same as before:
```bash
sudo sed -i 's/^#user_allow_other/user_allow_other/' /etc/fuse.conf
sudo tee /etc/systemd/system/gdrive.service >/dev/null <<'EOF'
[Unit]
Description=rclone shared drive mount
After=network-online.target
Wants=network-online.target
[Service]
Type=notify
User=krisnapradyana
ExecStart=/usr/bin/rclone mount gdrive: /gdrive \
  --vfs-cache-mode full --vfs-cache-max-size 20G --vfs-cache-max-age 24h \
  --dir-cache-time 10s --poll-interval 15s --allow-other
ExecStop=/bin/fusermount -u /gdrive
Restart=on-failure
RestartSec=10
[Install]
WantedBy=default.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now gdrive
```

## Phase 4 — Give the containers the mount

In `~/Hermes-Agent-Slack/docker-compose.yaml`, add to BOTH the hermes agent
service and `assistant-web`:
```yaml
    volumes:
      - /gdrive:/gdrive:rshared
```
Recreate, then confirm the agent can write to the real Drive:
```bash
sudo docker compose up -d --force-recreate
sudo docker exec <hermes-container> sh -c 'echo hi > "/gdrive/RND - PixelLab/_test.txt"'
# → appears in everyone's G:\...\RND - PixelLab within ~a minute. Delete after.
```

## Phase 5 — Path mapping (app side, already built)

Users type their familiar Windows path; the app maps it to the mount path
for the agent. Because your Shared Drive shows up under the shortcut prefix
on Windows, set the build args so the prefix maps to `/gdrive`:

```yaml
    build:
      args:
        NEXT_PUBLIC_DRIVE_BASE: "G:\\.shortcut-targets-by-id\\0B94M-NC2rvx2Y0EwZUU3emEwNWs\\SUPERPIXEL\\"
        NEXT_PUBLIC_DRIVE_MOUNT_BASE: "/gdrive/"
```

Then a working folder entered as
`G:\.shortcut-targets-by-id\0B94M-…\SUPERPIXEL\RND - PixelLab\Testing`
is handed to the agent as `/gdrive/RND - PixelLab/Testing` — the real
mounted Shared Drive path. Rebuild `assistant-web` after changing build args.

**Simpler for users:** tell them to enter the working folder as just
`G:\...\SUPERPIXEL\<rest>` however it appears in their Explorer address bar;
as long as it starts with the `NEXT_PUBLIC_DRIVE_BASE` prefix above, it maps
correctly. Paths that don't match the prefix fall back to the browser
courier automatically (no breakage).

## Verify end to end

1. Project working folder = the `Testing` path above.
2. Ask the agent to "create notes.md in the working folder."
3. It writes to `/gdrive/RND - PixelLab/Testing/notes.md` → shows in your
   `G:\...\Testing` within a minute, for every teammate.

## Rollback / troubleshooting

Same as the general rclone notes: `systemctl status gdrive`, check
`:rshared` propagation, watch `--vfs-cache-max-size` vs free disk. Files
live in the Shared Drive; the mount is only a view, so nothing is lost by
unmounting.
