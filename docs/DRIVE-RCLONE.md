# Mounting Google Drive on the server (rclone)

Goal: the Hermes agent reads and writes the same Google Drive folder your
team sees at `G:\My Drive\...`, so working folders "just work" with no
per-file steps.

## How it flows

```
Teammate PC:  G:\My Drive\RND - PixelLab
                    ↕  Google Drive for Desktop (already syncing today)
Google Drive (cloud)  ← single source of truth
                    ↕  rclone  (NEW: server signs in as the Drive owner)
Server:       /gdrive/RND - PixelLab
                    ↓  read/write like a normal folder
Hermes agent
```

Both sides point at the same cloud. A file the agent writes travels
cloud → Drive for Desktop → your `G:\` (seconds to minutes). And back.

Defaults used below — change if you prefer:
- rclone remote name: `gdrive`
- server mount path: `/gdrive`
- VFS cache cap: `20G`

---

## Phase 1 — Authorize rclone (headless)

The server has no browser, so we authorize on your Windows PC and paste the
token over.

**On the server:**
```bash
sudo -v ; curl https://rclone.org/install.sh | sudo bash
rclone version
```

**On your Windows PC** (install rclone from rclone.org/downloads, then in
PowerShell):
```powershell
rclone authorize "drive"
```
A browser opens → sign in with the Google account that owns
`RND - PixelLab` → approve. PowerShell prints a JSON token block. Copy the
whole `{...}`.

**On the server**, create the remote:
```bash
rclone config
# n) New remote
# name> gdrive
# Storage> drive          (Google Drive)
# client_id> (leave blank)
# client_secret> (leave blank)
# scope> 1                (full access)
# service_account_file> (leave blank)
# Edit advanced config> n
# Use auto config> n      ← IMPORTANT (headless)
# config_token> paste the {...} from your PC
# Configure as Shared Drive> n   (personal My Drive)
# Keep this remote> y
# q) Quit
```

Verify:
```bash
rclone lsd gdrive:            # lists top-level Drive folders
rclone ls "gdrive:RND - PixelLab" | head
```

---

## Phase 2 — Mount it as a service

Test first:
```bash
sudo mkdir -p /gdrive
sudo chown $USER /gdrive
rclone mount gdrive: /gdrive \
  --vfs-cache-mode full \
  --vfs-cache-max-size 20G \
  --vfs-cache-max-age 24h \
  --dir-cache-time 10s \
  --poll-interval 15s &
ls /gdrive                    # should show your Drive
```
`--dir-cache-time 10s` + `--poll-interval 15s` keep the listing fresh so
agent/external changes appear quickly. `--vfs-cache-mode full` gives normal
random-access read/write; the cache is capped at 20G and self-evicts.

Kill the test (`fusermount -u /gdrive`), then make it permanent with systemd:
```bash
sudo tee /etc/systemd/system/gdrive.service >/dev/null <<'EOF'
[Unit]
Description=rclone Google Drive mount
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
# --allow-other needs this line uncommented in /etc/fuse.conf:
sudo sed -i 's/^#user_allow_other/user_allow_other/' /etc/fuse.conf
sudo systemctl daemon-reload
sudo systemctl enable --now gdrive
systemctl status gdrive --no-pager
ls /gdrive
```

---

## Phase 3 — Give the container access

In `~/Hermes-Agent-Slack/docker-compose.yaml`, add the mount to the
**hermes agent service** (and optionally `assistant-web`):
```yaml
    volumes:
      - /gdrive:/gdrive:rshared
```
`rshared` propagation is what lets the container see a mount that rclone
attaches on the host after the container starts.

Apply and verify the agent sees it:
```bash
cd ~/Hermes-Agent-Slack
sudo docker compose up -d --force-recreate       # the hermes service
sudo docker exec <hermes-container> ls /gdrive
sudo docker exec <hermes-container> sh -c 'echo hi > "/gdrive/RND - PixelLab/_test.txt"'
```
Within a minute `_test.txt` should appear in your `G:\My Drive\RND - PixelLab`.
Delete it after.

---

## Phase 4 — Point projects at it (app side, already handled)

Artists keep typing the familiar `G:\My Drive\...` path. The app now
translates that to the mount path before handing it to the agent, using
these build args (set in the assistant-web build):

```yaml
    build:
      args:
        NEXT_PUBLIC_DRIVE_BASE: "G:\\My Drive\\"
        NEXT_PUBLIC_DRIVE_MOUNT_BASE: "/gdrive/"
```

So a working folder shown as `G:\My Drive\RND - PixelLab` is sent to the
agent as `/gdrive/RND - PixelLab`. Nothing for users to learn. If your
mount path differs, change `NEXT_PUBLIC_DRIVE_MOUNT_BASE` and rebuild.

---

## Verify end to end

1. In a project chat, working folder = `G:\My Drive\RND - PixelLab`.
2. Ask: "Create a file notes.md in the working folder with a hello line."
3. Within a minute it appears in your `G:\...` (via Drive for Desktop).
4. Edit a file in `G:\...`; ask the agent to read it — it sees your change.

---

## Rollback

```bash
sudo systemctl disable --now gdrive
# remove the /gdrive volume line from compose, then:
sudo docker compose up -d --force-recreate
```
No data is lost — files live in Google Drive; the mount is just a view.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ls /gdrive` empty on host | `systemctl status gdrive`; token may be invalid — redo Phase 1 |
| Container `/gdrive` empty but host OK | missing `:rshared`, or mount happened after container start — recreate container |
| Writes slow / disk fills | lower `--vfs-cache-max-size`; point cache at bigger disk with `--cache-dir` |
| "Too many requests" from Google | personal-account rate limit; pause heavy transfers, resume next day |
| Changes take a while to appear | expected — two sync hops through the cloud |

## When this grows up

Personal My Drive auths as one person (their quota, their token). If this
becomes core infra, move the folder to a **Shared Drive** and switch the
rclone remote to a **service account** — same mount mechanics, no personal
identity attached. The app needs no changes.
