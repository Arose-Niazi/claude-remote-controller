import fs from 'fs';
import path from 'path';
import os from 'os';

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

const CONFIG_DIR = path.join(os.homedir(), '.crc-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function loadConfig(): AgentConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig: AgentConfig = {
      agentId: os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      serverUrl: 'ws://localhost:3001',
      secret: 'changeme',
      shell: 'auto',
    };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    console.log(`Created default config at ${CONFIG_FILE} — edit it and restart.`);
    return defaultConfig;
  }

  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return JSON.parse(raw) as AgentConfig;
}
