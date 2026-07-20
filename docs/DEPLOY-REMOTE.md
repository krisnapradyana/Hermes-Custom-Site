# Deploying the site to the Docker host

Runs the SuperPixel Assistant web app on the same server as the Hermes
container. Benefits: one URL for the whole team, working folders finally
line up (app + agent share a filesystem), and Hermes' API port no longer
needs to be exposed to the internet.

## 1. Get the code onto the server

```bash
cd ~
git clone https://github.com/krisnapradyana/Hermes-Custom-Site.git
```

## 2. Add the web service to the existing compose

Edit `~/Hermes-Agent-Slack/docker-compose.yaml` and add this service
(same level as the hermes/seedance/oauth-helper services):

```yaml
  assistant-web:
    build:
      context: /home/krisnapradyana/Hermes-Custom-Site
      args:
        NEXT_PUBLIC_AUTH_ENABLED: "true"
    container_name: assistant-web
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - HERMES_API_URL=http://hermes-local-agent:8642
      - HERMES_API_MODE=openai
      - HERMES_API_KEY=${API_SERVER_KEY}
      - HERMES_MODEL=hermes-agent
      - NEXT_PUBLIC_AUTH_ENABLED=true
      - AUTH_URL=${ASSISTANT_PUBLIC_URL}
      - AUTH_SECRET=${ASSISTANT_AUTH_SECRET}
      - AUTH_SLACK_ID=${AUTH_SLACK_ID}
      - AUTH_SLACK_SECRET=${AUTH_SLACK_SECRET}
      - DATA_DIR=/app/data
    volumes:
      - ./assistant-data:/app/data
      - ./documents:/workspace/documents
```

Notes:
- `HERMES_API_URL` uses the container name — traffic stays on Docker's
  internal network. Once this works, you can DELETE the `"8642:8642"`
  port mapping from the hermes service so the agent API is no longer
  reachable from the internet at all.
- `${API_SERVER_KEY}` reuses the key already in `~/Hermes-Agent-Slack/.env`.
- `assistant-data` holds per-user chats/projects/artifacts. Back it up.
- `./documents:/workspace/documents` gives app + agent a shared folder —
  use paths like `/workspace/documents/<project>` as project working
  folders in the UI.

## 3. Add the new secrets to `~/Hermes-Agent-Slack/.env`

```bash
cd ~/Hermes-Agent-Slack
echo "ASSISTANT_PUBLIC_URL=https://assistant.example.com" >> .env
echo "ASSISTANT_AUTH_SECRET=$(openssl rand -base64 33)" >> .env
echo "AUTH_SLACK_ID=<client id from api.slack.com/apps>" >> .env
echo "AUTH_SLACK_SECRET=<client secret>" >> .env
```

`ASSISTANT_PUBLIC_URL` must be the HTTPS address users will visit (see
step 5) — Slack refuses http and raw-IP callbacks.

## 4. Build and start

```bash
cd ~/Hermes-Agent-Slack
sudo docker compose up -d --build assistant-web
sudo docker logs -f assistant-web     # wait for "Ready"
curl http://localhost:3000            # should return HTML
```

Rebuild after every `git pull` in Hermes-Custom-Site:
`sudo docker compose up -d --build assistant-web`

## 5. HTTPS in front (required for Slack login)

Pick one:

**A. Caddy + a domain (recommended, permanent).** Point a DNS record
(e.g. `assistant.example.com`) at the server, then add to compose:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    command: caddy reverse-proxy --from assistant.example.com --to assistant-web:3000
    volumes:
      - caddy-data:/data
volumes:
  caddy-data:
```

Caddy fetches and renews the TLS certificate automatically. Don't publish
port 3000 anymore in that case (remove the `"3000:3000"` mapping).

**B. ngrok on the server (quick, for the team test).**

```bash
ngrok http --url=<your-static-domain>.ngrok-free.app 3000
```

Either way, set `ASSISTANT_PUBLIC_URL` to that HTTPS URL and add
`<url>/api/auth/callback/slack` to the Slack app's Redirect URLs.

## 6. Update the Slack app

OAuth & Permissions → Redirect URLs → add:

```
https://<your-public-url>/api/auth/callback/slack
```

## 7. Verify

1. Open the public URL → Slack sign-in appears → login works.
2. Status bar bottom-left: "Hermes online".
3. Send a chat message → streamed reply.
4. Scheduler and Agent history pages load data.
5. Create a project with working folder `/workspace/documents/test` —
   the workspace panel lists it AND the agent can write files there.

## Gotchas

- `NEXT_PUBLIC_AUTH_ENABLED` is baked at BUILD time (it's a build arg).
  Changing it requires `--build`, not just a restart.
- Local-open ("Open in default app") auto-disables for everyone here,
  since nobody browses the server via localhost — files stream to each
  user's own browser instead. This is correct behavior.
- Windows-style working folders (`E:\...`) from your old local projects
  won't exist in the container — edit those projects to `/workspace/...`
  paths after migrating.
