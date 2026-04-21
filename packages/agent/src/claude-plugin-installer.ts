import { mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';

const PLUGIN_NAME = 'remote-notify';
const PLUGIN_VERSION = '1.0.0';
const MARKETPLACE_KEY = 'crc';
const REGISTRY_KEY = `${PLUGIN_NAME}@${MARKETPLACE_KEY}`;

function getPluginDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return join(home, '.claude', 'plugins', 'cache', MARKETPLACE_KEY, PLUGIN_NAME, PLUGIN_VERSION);
}

function getRegistryPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return join(home, '.claude', 'plugins', 'installed_plugins.json');
}

// ── Plugin file contents ────────────────────────────────────────────

const PLUGIN_JSON = JSON.stringify({
  name: PLUGIN_NAME,
  description: 'Remote browser notifications for Claude Remote Controller',
  version: PLUGIN_VERSION,
  author: { name: 'CRC' },
}, null, 2);

const HOOKS_JSON = JSON.stringify({
  description: 'CRC remote notifications',
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/on-stop.sh' }] }],
    Notification: [
      { matcher: 'idle_prompt', hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/on-notification.sh' }] },
    ],
    PermissionRequest: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/on-permission-request.sh' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/on-prompt-submit.sh' }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/scripts/on-post-tool-use.sh' }] }],
  },
}, null, 2);

// Shared notify helper — writes an OSC 777 sequence to /dev/tty
const NOTIFY_SH = `#!/bin/bash
printf '\\033]777;notify;crc://agent;%s\\007' "$1" > /dev/tty 2>/dev/null || true
`;

const ON_STOP_SH = `#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
INPUT=$(cat)

# Skip if another stop hook already fired (e.g. Warp plugin)
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$STOP_ACTIVE" = "true" ] && exit 0

QUERY=""
RESPONSE=""

if command -v jq &>/dev/null; then
  TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
  sleep 0.3
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    QUERY=$(jq -rs '
      [.[] | select(.type == "user") |
        if .message.content | type == "string" then .
        elif [.message.content[] | select(.type == "text")] | length > 0 then .
        else empty end
      ] | last |
      if .message.content | type == "array"
      then [.message.content[] | select(.type == "text") | .text] | join(" ")
      else .message.content // empty end
    ' "$TRANSCRIPT" 2>/dev/null)
    RESPONSE=$(jq -rs '
      [.[] | select(.type == "assistant" and .message.content)] | last |
      [.message.content[] | select(.type == "text") | .text] | join(" ")
    ' "$TRANSCRIPT" 2>/dev/null)
    [ \${#QUERY} -gt 200 ] && QUERY="\${QUERY:0:197}..."
    [ \${#RESPONSE} -gt 200 ] && RESPONSE="\${RESPONSE:0:197}..."
  fi
  BODY=$(jq -nc --arg event stop --arg query "$QUERY" --arg response "$RESPONSE" '$ARGS.named')
else
  BODY='{"event":"stop"}'
fi

"$SCRIPT_DIR/notify.sh" "$BODY"
`;

const ON_NOTIFICATION_SH = `#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
INPUT=$(cat)
MSG="Waiting for input"
if command -v jq &>/dev/null; then
  MSG=$(echo "$INPUT" | jq -r '.message // "Waiting for input"' 2>/dev/null)
fi
BODY='{"event":"idle_prompt"}'
if command -v jq &>/dev/null; then
  BODY=$(jq -nc --arg event idle_prompt --arg summary "$MSG" '$ARGS.named')
fi
"$SCRIPT_DIR/notify.sh" "$BODY"
`;

const ON_PERMISSION_REQUEST_SH = `#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
INPUT=$(cat)
SUMMARY="Permission needed"
if command -v jq &>/dev/null; then
  TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
  PREVIEW=$(echo "$INPUT" | jq -r '(.tool_input | if .command then .command elif .file_path then .file_path else (tostring | .[0:80]) end) // ""' 2>/dev/null)
  SUMMARY="Wants to run $TOOL"
  [ -n "$PREVIEW" ] && SUMMARY="$SUMMARY: \${PREVIEW:0:120}"
  BODY=$(jq -nc --arg event permission_request --arg summary "$SUMMARY" --arg tool_name "$TOOL" '$ARGS.named')
else
  BODY='{"event":"permission_request","summary":"Permission needed"}'
fi
"$SCRIPT_DIR/notify.sh" "$BODY"
`;

const ON_PROMPT_SUBMIT_SH = `#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
BODY='{"event":"prompt_submit"}'
if command -v jq &>/dev/null; then
  INPUT=$(cat)
  QUERY=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null)
  [ \${#QUERY} -gt 200 ] && QUERY="\${QUERY:0:197}..."
  BODY=$(jq -nc --arg event prompt_submit --arg query "$QUERY" '$ARGS.named')
fi
"$SCRIPT_DIR/notify.sh" "$BODY"
`;

const ON_POST_TOOL_USE_SH = `#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
BODY='{"event":"tool_complete"}'
if command -v jq &>/dev/null; then
  INPUT=$(cat)
  TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
  BODY=$(jq -nc --arg event tool_complete --arg tool_name "$TOOL" '$ARGS.named')
fi
"$SCRIPT_DIR/notify.sh" "$BODY"
`;

// ── Installer ───────────────────────────────────────────────────────

function writeScript(dir: string, name: string, content: string): void {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf-8');
  chmodSync(path, 0o755);
}

function updateRegistry(installPath: string): void {
  const registryPath = getRegistryPath();
  let registry: any = { version: 2, plugins: {} };
  try {
    if (existsSync(registryPath)) {
      registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    }
  } catch {
    // Corrupt file — start fresh
  }

  const now = new Date().toISOString();
  registry.plugins[REGISTRY_KEY] = [{
    scope: 'user',
    installPath,
    version: PLUGIN_VERSION,
    installedAt: now,
    lastUpdated: now,
  }];

  writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

function isCurrentVersion(): boolean {
  const pluginDir = getPluginDir();
  try {
    const meta = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf-8'));
    return meta.version === PLUGIN_VERSION;
  } catch {
    return false;
  }
}

export function installClaudePlugin(): void {
  if (isCurrentVersion()) {
    logger.info('CRC Claude Code plugin already installed (v%s)', PLUGIN_VERSION);
    return;
  }

  const pluginDir = getPluginDir();
  try {
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    mkdirSync(join(pluginDir, 'scripts'), { recursive: true });

    writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), PLUGIN_JSON, 'utf-8');
    writeFileSync(join(pluginDir, 'hooks', 'hooks.json'), HOOKS_JSON, 'utf-8');

    writeScript(join(pluginDir, 'scripts'), 'notify.sh', NOTIFY_SH);
    writeScript(join(pluginDir, 'scripts'), 'on-stop.sh', ON_STOP_SH);
    writeScript(join(pluginDir, 'scripts'), 'on-notification.sh', ON_NOTIFICATION_SH);
    writeScript(join(pluginDir, 'scripts'), 'on-permission-request.sh', ON_PERMISSION_REQUEST_SH);
    writeScript(join(pluginDir, 'scripts'), 'on-prompt-submit.sh', ON_PROMPT_SUBMIT_SH);
    writeScript(join(pluginDir, 'scripts'), 'on-post-tool-use.sh', ON_POST_TOOL_USE_SH);

    updateRegistry(pluginDir);
    logger.info('Installed CRC Claude Code plugin v%s at %s', PLUGIN_VERSION, pluginDir);
  } catch (err) {
    logger.warn({ err }, 'Failed to install CRC Claude Code plugin — notifications will use JSONL fallback');
  }
}
