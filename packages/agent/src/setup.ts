#!/usr/bin/env node
import fs from 'fs';
import readline from 'readline';
import { CONFIG_DIR, CONFIG_FILE, defaultAgentId, type AgentConfig } from './config.js';

interface EnrollToken {
  v?: number;
  serverUrl: string;
  agentId: string;
  secret: string;
}

function parseArgs(argv: string[]): { token?: string; help?: boolean } {
  const out: { token?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--token' || a === '-t') {
      out.token = argv[++i];
    } else if (a.startsWith('--token=')) {
      out.token = a.slice('--token='.length);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function decodeToken(token: string): EnrollToken {
  // base64url JSON — {v, serverUrl, agentId, secret}
  const json = Buffer.from(token, 'base64url').toString('utf-8');
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid token: not valid base64url-encoded JSON.');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid token payload.');
  if (!parsed.serverUrl || !parsed.agentId || !parsed.secret) {
    throw new Error('Invalid token: missing serverUrl, agentId, or secret.');
  }
  return parsed as EnrollToken;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

function writeConfig(cfg: AgentConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  console.log(`Saved. Start the agent with: crc-agent`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      [
        'Usage: crc-agent setup [--token <base64url>]',
        '',
        'Enroll this machine as a Claude Remote agent.',
        '',
        'Modes:',
        '  --token <token>   Enroll from the token shown in the web "Add agent" dialog.',
        '  (no args)         Interactive prompts for serverUrl, agentId, secret.',
        '',
        'Environment overrides (skip prompts): CRC_SERVER_URL, CRC_AGENT_ID, CRC_SECRET',
        '',
        `Config is written to ${CONFIG_FILE}`,
      ].join('\n')
    );
    return;
  }

  const exists = fs.existsSync(CONFIG_FILE);

  // 1) Token mode — overwrites without prompting.
  if (args.token) {
    const t = decodeToken(args.token);
    writeConfig({ agentId: t.agentId, serverUrl: t.serverUrl, secret: t.secret, shell: 'auto' });
    return;
  }

  // 2) Env-override mode — if all three are present, overwrite without prompting.
  const envServer = process.env.CRC_SERVER_URL;
  const envAgent = process.env.CRC_AGENT_ID;
  const envSecret = process.env.CRC_SECRET;
  if (envServer && envSecret) {
    writeConfig({
      agentId: envAgent || defaultAgentId(),
      serverUrl: envServer,
      secret: envSecret,
      shell: 'auto',
    });
    return;
  }

  // 3) Interactive mode.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (exists) {
      const overwrite = await ask(rl, `Config already exists at ${CONFIG_FILE}. Overwrite? (y/N) `);
      if (!/^y(es)?$/i.test(overwrite.trim())) {
        console.log('Aborted. Existing config left unchanged.');
        return;
      }
    }

    const serverUrl = (envServer || (await ask(rl, 'Server URL (e.g. wss://crc.example.com): '))).trim();
    if (!serverUrl) throw new Error('Server URL is required.');

    const agentIdRaw = envAgent || (await ask(rl, `Agent ID [${defaultAgentId()}]: `));
    const agentId = (agentIdRaw || '').trim() || defaultAgentId();

    const secret = (envSecret || (await ask(rl, 'Agent secret: '))).trim();
    if (!secret) throw new Error('Secret is required.');

    writeConfig({ agentId, serverUrl, secret, shell: 'auto' });
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
