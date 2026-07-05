import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface VpnProfileConfig {
  id: string;
  name: string;
  type: 'wireguard' | 'openvpn' | 'azure';
  configFile?: string;     // path to .conf/.ovpn — absolute or relative to ~/.crc-agent/vpn/
  tunnelName?: string;     // WireGuard: tunnel service name (defaults to id)
  serviceName?: string;    // macOS: network service name from `scutil --nc list` (e.g., "My Server")
  tunnelblickName?: string; // macOS OpenVPN: Tunnelblick configuration name (from `osascript -e 'tell application "Tunnelblick" to get name of configurations'`)
}

export interface AgentConfig {
  agentId: string;
  serverUrl: string;
  secret: string;
  shell: string;
  homeDir?: string;
  vpn?: {
    profiles: VpnProfileConfig[];
  };
}

export const CONFIG_DIR = path.join(os.homedir(), '.crc-agent');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Legacy placeholder secret from older default configs — treated as "not configured".
const PLACEHOLDER_SECRET = 'changeme';

// Loopback port the agent listens on for Claude Code hook callbacks (so events
// fired while Claude runs in Warp/tmux reach the agent -> server -> push).
export const LOCAL_CONTROL_PORT = Number(process.env.CRC_LOCAL_PORT) || 47600;

export function defaultAgentId(): string {
  return os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function defaultConfig(): AgentConfig {
  return {
    agentId: defaultAgentId(),
    // No serverUrl by default — the agent must be enrolled via `crc-agent setup`.
    serverUrl: '',
    // Random secret so an unconfigured install never ships a known secret.
    secret: crypto.randomBytes(24).toString('hex'),
    shell: 'auto',
  };
}

/**
 * True only when a real, usable config exists: file present, parseable, with a
 * non-empty serverUrl and a secret that isn't the legacy placeholder.
 */
export function isConfigured(): boolean {
  if (!fs.existsSync(CONFIG_FILE)) return false;
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const cfg = JSON.parse(raw.replace(/^﻿/, '')) as Partial<AgentConfig>;
    if (!cfg.serverUrl || !cfg.secret) return false;
    if (cfg.secret === PLACEHOLDER_SECRET) return false;
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(): AgentConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    const config = defaultConfig();
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log(`Created default config at ${CONFIG_FILE} — run \`crc-agent setup\` to enroll.`);
    return config;
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    // Strip a leading UTF-8 BOM (e.g., files saved by Windows Notepad) before parsing.
    return JSON.parse(raw.replace(/^﻿/, '')) as AgentConfig;
  } catch (err) {
    console.error(
      `Failed to read/parse config at ${CONFIG_FILE}: ${(err as Error).message}\n` +
        'Falling back to default config. Fix the file and restart to apply your settings.'
    );
    return defaultConfig();
  }
}
