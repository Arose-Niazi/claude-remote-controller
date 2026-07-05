# cli-remote-agent

The **agent** for [Claude Remote Controller](https://github.com/Arose-Niazi/claude-remote-controller). Install it on any machine you want to reach from the CRC web app. It connects out to your self-hosted CRC server and exposes:

- a full terminal (via `node-pty`)
- a file explorer + file downloads
- a bridge to your local Claude Code sessions, transcripts, and notify hooks

> **Security note:** running this agent grants the owner of the connected CRC account a **remote shell on this machine** under your user account. Only enroll it against a server you control, and keep the agent secret private.

## Prerequisites

- **Node.js >= 20**
- Native build tools for `node-pty` (only needed if a prebuilt binary isn't available for your platform):
  - **macOS:** `xcode-select --install`
  - **Debian/Ubuntu:** `sudo apt-get install -y python3 make g++`
  - **Windows:** usually ships prebuilt — no extra tooling required

## Install

```bash
npm i -g cli-remote-agent
```

## Enroll (first-run setup)

In the CRC web app, open the **Add agent** dialog to get an enrollment token, then run:

```bash
crc-agent setup --token <token from the web Add-agent dialog>
```

Prefer to enter details by hand? Run `crc-agent setup` with no arguments for interactive prompts (server URL, agent ID, secret). You can also set `CRC_SERVER_URL`, `CRC_AGENT_ID`, and `CRC_SECRET` in the environment to skip the prompts.

## Run

```bash
crc-agent
```

The agent connects to your server and reconnects automatically. If you run `crc-agent` before enrolling, it prints:

```
No agent configured. Run: crc-agent setup
```

## Configuration

Setup writes `~/.crc-agent/config.json`:

```json
{
  "agentId": "my-machine",
  "serverUrl": "wss://crc.example.com",
  "secret": "…",
  "shell": "auto"
}
```

You can edit this file directly; restart the agent to apply changes.

## Run at startup (optional)

- **Windows:** `crc-agent` ships helper scripts to register a logon startup entry (`npm run service:install` from the package, or the equivalent in your process manager).
- **macOS/Linux:** use your preferred supervisor (`launchd`, `systemd --user`, `pm2`, etc.) to keep `crc-agent` running.

## License

MIT
