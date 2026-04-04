import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AgentConfig {
  agentId: string;
  serverUrl: string;
  secret: string;
  shell: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.crc-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function loadConfig(): AgentConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    // Create default config
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
