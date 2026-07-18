# Claude Remote Controller

Drive **Claude Code** (and plain shells) on your desktop machines from your phone
or any browser. A small self-hosted relay lets you open terminals, watch Claude
work in real time, get a push notification the moment a task finishes, tap it to
read the transcript, and re-prompt — from anywhere. It's a PWA: add it to your
home screen and it behaves like a native app.

Multi-user: run one relay and give accounts to friends. Each account only ever
sees and controls **its own** machines.

```
 phone / browser  ──ws──►  relay (you host)  ◄──ws──  agent (your Mac / PC)
        │                        │                          │
   PWA + Web Push          per-user rooms         node-pty · tmux · Claude hooks
```

---

## What you can do

### 🖥 Terminals
- Open **multiple live terminals** per machine (up to 10), each a real PTY.
- **Sessions survive disconnects** — lock your phone, lose signal, or the agent
  reconnects, and your terminal is still there. Output is buffered while you're
  away and replayed on reattach. Detached sessions are kept for 6 hours.
- **Rename**, **kill**, or **kill all** sessions. Reconnecting from another device
  hands the session over cleanly.
- Two ways to type: a **compose bar** (type a line, tap send — mobile-friendly)
  or **TTY mode** (raw keyboard straight to the terminal). A **mobile keys bar**
  adds ESC / TAB / CTRL / ALT / Ctrl-C / Ctrl-Z / arrow keys, and there's a
  "send raw (no enter)" option.

### 🔗 tmux mirror — share the exact session on your PC
- **Mirror** a tmux session so your phone and your desktop (Warp/iTerm/tmux) are
  attached to the **same** live session — watch and drive the same Claude run
  from either device.
- Your machine's tmux sessions are **listed automatically**, enriched with each
  session's **folder** and the **live Claude chat name + status** (busy/idle)
  running inside it — so you know exactly which is which.
- **Scroll** the mirror with mouse wheel or touch-drag (forwarded to Claude, so
  you scroll the conversation just like on the desktop), **kill** a session, start
  a **new named session**, or launch Claude in a project's own tmux session.

### 🤖 Claude Code, first-class
- **Browse past Claude sessions** grouped by project, with first message, model,
  message count, and git branch — then **resume** any of them in one tap.
- **Start a new Claude** in any project. A first-run chooser lets you pick a
  permission mode (Bypass / Default / Plan).
- **Live chat view**: Claude's transcript renders as a clean chat (markdown, code
  blocks, tool calls) that updates as it works — read what it's doing and reply
  from the compose bar.
- **Interactive prompts become buttons**: when Claude asks a permission/choice
  question, the numbered options show as tappable buttons.
- **File links in chat are downloadable** — tap a path Claude mentions to pull
  the file to your phone.

### 🔔 Notifications
- Get a **push notification** the moment Claude finishes a turn or needs your
  input — **even when Claude is running in Warp/tmux outside the app**. Tap it to
  open a read-only transcript of exactly what happened.
- Works cross-platform: Claude Code hooks on Mac/Linux, plus a terminal-watching
  fallback (so it works on Windows too, and even without shell hooks).
- Per-device Web Push, in-app toasts, a sound + tab-flash when the app isn't
  focused, and a **bell toggle** to turn it all on/off.

### 🌐 VPN control (macOS/Linux)
- List, **connect**, and **disconnect** VPN profiles (WireGuard / OpenVPN /
  Azure) configured on the machine — handy before file work or reaching internal
  hosts. Configured in the agent's `config.json`.

### 📁 File explorer + transfer
- **Browse the machine's filesystem**, **download** files to your phone, and
  **upload** files up to the machine. Repos show a **git pull** button.

### 🔒 Multi-user & secure by design
- Admins create accounts for friends; **each user only sees their own machines**
  (owner-scoped, verified end-to-end). Passwords and agent secrets are
  scrypt-hashed; login tokens are HMAC-signed with a revocation version.

### ⚙️ Agent niceties
- **Keeps a Mac awake** while running (`caffeinate -i`) so it doesn't idle-sleep
  and drop the connection — lid-close still sleeps.
- **Single-instance lock** (no duplicate agents), **auto-reconnect**, crash-
  resilient, `crc-agent --version`, and optional auto-start on login.

---

## How it works

Three parts:

- **Relay server** (`packages/server`) — Node + Express + Socket.IO. Auth,
  per-user isolation, file transfer, Web Push. Serves the web app. This is the
  one thing you host.
- **Agent** (`packages/agent`, published as
  [`cli-remote-agent`](https://www.npmjs.com/package/cli-remote-agent)) — a
  node-pty host you run on each machine you want to control. It connects **out**
  to the relay, so the machine needs no inbound ports.
- **Web app** (`packages/web`) — a React PWA served by the relay.

> **⚠️ Trust model.** An agent grants whoever owns its account a **remote shell**
> and **file access** on that machine, under your user account. Per-user
> isolation guarantees no one can reach an agent they don't own — but only enroll
> an agent against a relay you trust. Treat your relay like SSH access to every
> connected machine.

---

## Self-host the relay

Requirements: a host with Docker, and a domain behind a TLS reverse proxy
(Nginx Proxy Manager, Caddy, Traefik…).

1. Copy `.env.example` to `.env` and fill it in:
   - `ADMIN_PASSWORD` — seeds the first `admin` account on first boot.
   - `TOKEN_SECRET` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — `npx web-push generate-vapid-keys`
     (enables push). Set `VAPID_SUBJECT` to a `mailto:` you control.
   - `DATA_DIR` — a persisted volume (accounts, agents, transcripts, uploads).
   - Optional: `ALLOWED_ORIGINS` (CORS allowlist), `TOKEN_TTL_DAYS` (default 30).
2. Build & run (a `Dockerfile` is included):
   ```bash
   docker compose up -d --build
   ```
3. Put it behind your reverse proxy on your domain (**WebSocket upgrade enabled**).
4. Open the site and log in as **`admin`** with your `ADMIN_PASSWORD`.

State is plain JSON under `DATA_DIR` (`users.json`, `agents.json`) — easy to back
up; no external database. In production the server refuses to boot with a weak or
placeholder `TOKEN_SECRET` / `ADMIN_PASSWORD`.

## Add users and enroll agents

- **Admin → "Users"**: create an account for each friend (username + password).
- **Any user → "+ Add agent"**: names the machine, mints a one-time enrollment
  token, and shows the exact install command to run on it.

## Run an agent on a machine

Prereqs: **Node ≥ 20**. `node-pty` builds natively where no prebuilt binary
exists — macOS: `xcode-select --install`; Debian/Ubuntu:
`sudo apt-get install -y python3 make g++`; Windows is usually prebuilt. For tmux
mirroring, install `tmux` (macOS: `brew install tmux`; Linux: your package
manager; Windows: via WSL).

```bash
npm install -g cli-remote-agent
crc-agent setup --token <TOKEN FROM THE "Add agent" DIALOG>
crc-agent
```

`setup` writes `~/.crc-agent/config.json`. See
[`packages/agent/README.md`](packages/agent/README.md) for VPN profiles,
auto-start, environment variables, and other options.

## Development

npm workspaces monorepo:

```bash
npm install
npm run build          # shared + server + web
npm run dev:server     # / dev:agent / dev:web
```

- `packages/shared` — protocol / types / constants (bundled into the agent).
- The agent builds with `tsup`; the server/web with `tsc` / Vite.

## License

MIT — see [LICENSE](LICENSE).
