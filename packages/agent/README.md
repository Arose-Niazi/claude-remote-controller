# cli-remote-agent

The **agent** for [Claude Remote Controller](https://github.com/Arose-Niazi/claude-remote-controller)
— control **Claude Code** and shells on this machine from your phone or any
browser. Install it on any machine you want to reach, enroll it against your
self-hosted CRC relay, and run it. It connects **out** to the relay (no inbound
ports needed) and exposes that machine to your CRC account.

Once enrolled, from the CRC web app (a PWA — add it to your home screen) you can:

- 🖥 **Open live terminals** — multiple per machine, that **survive disconnects**
  (lock your phone / lose signal and your session and its output are still there
  on reattach). Rename, kill, TTY (raw) or compose mode, plus a mobile keys bar
  (ESC/TAB/CTRL/ALT/Ctrl-C/Ctrl-Z/arrows).
- 🔗 **Mirror tmux sessions** — attach your phone to the *same* tmux session open
  in Warp/tmux on the desktop and drive the same Claude run from either. Your
  tmux sessions are listed automatically with their folder and the live Claude
  chat name/status; scroll with wheel/touch, kill, or start new named sessions.
- 🤖 **Claude Code, first-class** — browse and **resume** past Claude sessions
  (grouped by project), start a new Claude, read the transcript as a **live
  chat**, tap through permission prompts, and download files Claude mentions.
- 🔔 **Get notified** when Claude finishes or needs input — even when it's running
  outside the app (Warp/tmux) — via Web Push; tap to read the transcript.
- 🌐 **VPN control** (macOS/Linux) — connect/disconnect WireGuard / OpenVPN /
  Azure profiles.
- 📁 **File explorer** — browse, **download** files to your phone, **upload** to
  the machine, `git pull` in repos.

> **Security note:** running this agent grants the owner of the connected CRC
> account a **remote shell and file access on this machine**, under your user
> account. Only enroll it against a relay you control, and keep the agent secret
> private. Other users of the relay can't see or reach your machine — agents are
> owner-scoped.

## Prerequisites

- **Node.js ≥ 20**
- Native build tools for `node-pty` (only if no prebuilt binary exists):
  - **macOS:** `xcode-select --install`
  - **Debian/Ubuntu:** `sudo apt-get install -y python3 make g++`
  - **Windows:** usually ships prebuilt — no extra tooling required
- **tmux** (optional, for the mirror feature) — macOS: `brew install tmux`;
  Linux: your package manager; Windows: via WSL.

## Install

```bash
npm i -g cli-remote-agent
```

Check the version anytime:

```bash
crc-agent --version
```

## Enroll (first-run setup)

In the CRC web app, open the **+ Add agent** dialog to get an enrollment token,
then run:

```bash
crc-agent setup --token <token from the web Add-agent dialog>
```

Prefer to enter details by hand? Run `crc-agent setup` with no arguments for
interactive prompts (server URL, agent ID, secret). You can also set
`CRC_SERVER_URL`, `CRC_AGENT_ID`, and `CRC_SECRET` in the environment to skip the
prompts.

## Run

```bash
crc-agent
```

The agent connects to your relay and reconnects automatically. Running
`crc-agent` before enrolling prints `No agent configured. Run: crc-agent setup`.
Only one agent can run per machine — a second start exits with a message (set
`CRC_ALLOW_MULTIPLE=1` to override).

### Commands

| Command | Description |
|---|---|
| `crc-agent` | Start the agent. |
| `crc-agent setup [--token <t>]` | Enroll this machine (`--help` for details). |
| `crc-agent -v`, `--version` | Print the installed version. |
| `crc-agent -h`, `--help` | Show help. |

## Configuration

Setup writes `~/.crc-agent/config.json`:

```json
{
  "agentId": "my-machine",
  "serverUrl": "wss://crc.example.com",
  "secret": "…",
  "shell": "auto",
  "homeDir": "/Users/me/projects"
}
```

- `shell` — `"auto"` detects your login shell; or set an explicit path.
- `homeDir` (optional) — default working directory for new terminals.

Edit the file directly and restart the agent to apply changes.

### VPN profiles (optional, macOS/Linux)

Add a `vpn.profiles` array to `config.json` to control VPNs from the app:

```json
{
  "vpn": {
    "profiles": [
      { "id": "work", "name": "Work WireGuard", "type": "wireguard", "tunnelName": "work" },
      { "id": "home", "name": "Home OpenVPN", "type": "openvpn", "tunnelblickName": "home" }
    ]
  }
}
```

Supported `type`s: `wireguard`, `openvpn`, `azure`. Place config files at an
absolute path or under `~/.crc-agent/vpn/`. VPN control is disabled on Windows.

### Environment variables

| Variable | Effect |
|---|---|
| `CRC_SERVER_URL`, `CRC_AGENT_ID`, `CRC_SECRET` | Non-interactive enrollment. |
| `CRC_ALLOW_MULTIPLE=1` | Allow more than one agent instance. |
| `CRC_ALLOW_SLEEP=1` | macOS: don't hold `caffeinate` (let the Mac idle-sleep). |
| `CRC_LOCAL_PORT` | Loopback port for Claude hook notifications (default 47600). |

## Notes for this platform

- **macOS:** the agent runs `caffeinate -i` while active so the Mac won't
  idle-sleep and drop the connection (the display can still sleep; closing the
  lid still sleeps). Opt out with `CRC_ALLOW_SLEEP=1`.
- **Claude notifications:** the agent installs a Claude Code `Stop` hook into
  `~/.claude/settings.json` so you get notified even when Claude runs outside a
  CRC terminal. A terminal-watching fallback covers Windows and hook-less setups.

## Run at startup (optional)

- **Windows:** `npm run service:install` from the package registers a logon
  startup entry.
- **macOS/Linux:** use your preferred supervisor (`launchd`, `systemd --user`,
  `pm2`, …) to keep `crc-agent` running.

## License

MIT
