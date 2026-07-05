# Claude Remote Controller

Drive Claude Code (and shells) on your desktop machines from your phone or any
browser. A small self-hosted relay lets you open terminals, watch Claude's
progress, get a push notification the moment a task finishes, tap it to read the
transcript, and re-prompt — from anywhere.

Multi-user: run one relay and give accounts to friends. Each account only ever
sees and controls **its own** agents.

## How it works

Three parts:

- **Relay server** (`packages/server`) — Node + Express + Socket.IO. Auth,
  per-user isolation, file transfer, Web Push. Serves the web app. This is the
  one thing you host.
- **Agent** (`packages/agent`, published as [`cli-remote-agent`](#run-an-agent-on-a-machine))
  — a node-pty host you run on each machine you want to control. It connects out
  to the relay, so the machine needs no inbound ports.
- **Web app** (`packages/web`) — a React PWA served by the relay. Add it to your
  home screen for push notifications.

```
 phone / browser  ──ws──►  relay (you host)  ◄──ws──  agent (your PC / a friend's PC)
        │                        │                          │
   PWA + Web Push          per-user rooms            node-pty, Claude hooks
```

> **⚠️ Trust model.** An agent grants whoever owns it a **remote shell**
> (`AGENT_EXEC`) and **whole-disk file read** on that machine. Per-user isolation
> guarantees no one can reach an agent they don't own — but only enroll an agent
> if you trust the relay's operator and your own account. Treat your relay like
> SSH access to every connected machine.

## Self-host the relay

Requirements: a host with Docker, and a domain behind a TLS reverse proxy
(Nginx Proxy Manager, Caddy, Traefik…).

1. Copy `.env.example` to `.env` and fill it in:
   - `ADMIN_PASSWORD` — seeds the first `admin` account on first boot.
   - `TOKEN_SECRET` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — `npx web-push generate-vapid-keys` (enables push). Set `VAPID_SUBJECT` to a `mailto:` you control.
   - `DATA_DIR` — a persisted volume (accounts, agents, transcripts, uploads live here).
   - Optional: `ALLOWED_ORIGINS` (CORS allowlist), `TOKEN_TTL_DAYS` (default 30).
2. Build & run (a `Dockerfile` is included):
   ```bash
   docker compose up -d --build
   ```
3. Put it behind your reverse proxy on your domain (WebSocket upgrade enabled).
4. Open the site and log in as **`admin`** with your `ADMIN_PASSWORD`.

State is plain JSON under `DATA_DIR` (`users.json`, `agents.json`) — easy to back
up; no external database.

## Add users and enroll agents

- **Admin → "Users"**: create an account for each friend (username + password).
- **Any user → "Add agent"**: generates a one-time enrollment token and shows the
  exact install command to run on the target machine.

## Run an agent on a machine

Prereqs: **Node ≥ 20**. `node-pty` builds natively where no prebuilt binary
exists — macOS: `xcode-select --install`; Debian/Ubuntu:
`sudo apt-get install -y python3 make g++`; Windows is usually prebuilt.

```bash
npm install -g cli-remote-agent
crc-agent setup --token <TOKEN FROM THE "Add agent" DIALOG>
crc-agent
```

`setup` writes `~/.crc-agent/config.json`. See
[`packages/agent/README.md`](packages/agent/README.md) for auto-start and options.

## Notifications

The agent installs Claude Code `Stop` hooks into `~/.claude/settings.json`. When
a Claude turn finishes (in any terminal, incl. Warp/tmux), you get a Web Push
with the folder + result; tapping it opens the read-only transcript. Toggle
notifications on/off with the bell in the app header (per device).

## Development

npm workspaces monorepo:

```bash
npm install
npm run build          # shared + server + web
npm run dev:server     # / dev:agent / dev:web
```

- `packages/shared` — protocol/types/constants (bundled into the agent at build).
- The agent builds with `tsup` (`npm run build:agent`); the server/web with `tsc`.

## License

MIT — see [LICENSE](LICENSE).
