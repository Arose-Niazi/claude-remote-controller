import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from './logger.js';
import type { ClaudeHookPayload } from '@crc/shared';

// We install notify hooks by writing them directly into ~/.claude/settings.json
// (merged, idempotent). This is far more reliable than the plugin mechanism —
// plugins only load from a registered marketplace, whereas user-settings hooks
// always load. Works on macOS, Linux, and Windows (Claude runs command hooks via
// Git Bash there); needs only curl (present on all three).

function getSettingsPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return join(home, '.claude', 'settings.json');
}

// Events we hook: Stop (turn finished) and Notification (Claude needs
// attention — permission / idle prompt).
const NOTIFY_EVENTS = ['Stop', 'Notification'] as const;

export function installClaudeHooks(port: number): void {
  const settingsPath = getSettingsPath();
  const url = `http://127.0.0.1:${port}/hook`;
  // Read the hook's JSON from stdin and POST it to the local agent endpoint.
  // Always exit 0 and stay quiet so it never interferes with Claude's flow.
  const command = `curl -s -m 2 -X POST -H "Content-Type: application/json" --data-binary @- ${url} >/dev/null 2>&1 || true`;

  let settings: Record<string, any> = {};
  try {
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    }
  } catch (err) {
    logger.warn({ err }, 'Could not parse ~/.claude/settings.json — skipping hook install');
    return;
  }

  const hooks: Record<string, any[]> = settings.hooks || (settings.hooks = {});
  const isOurs = (group: unknown) => JSON.stringify(group).includes(url);
  const desired = { hooks: [{ type: 'command', command }] };

  let changed = false;
  for (const ev of NOTIFY_EVENTS) {
    const groups = Array.isArray(hooks[ev]) ? hooks[ev] : [];
    const next = [...groups.filter((g) => !isOurs(g)), desired];
    if (JSON.stringify(hooks[ev]) !== JSON.stringify(next)) {
      hooks[ev] = next;
      changed = true;
    }
  }

  if (!changed) {
    logger.info('CRC Claude notify hooks already present in settings.json');
    return;
  }

  try {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    logger.info({ events: NOTIFY_EVENTS, url }, 'Installed CRC Claude notify hooks into settings.json (restart claude to apply)');
  } catch (err) {
    logger.warn({ err }, 'Failed to write CRC notify hooks to settings.json');
  }
}

/**
 * Normalize a raw Claude Code hook payload (native format, keyed by
 * hook_event_name) into our simplified {event, ...} shape. Returns null for
 * events we don't notify on.
 */
export function normalizeClaudeHook(raw: any): ClaudeHookPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  // Already our simplified format (e.g. a manual test POST).
  if (typeof raw.event === 'string' && !raw.hook_event_name) return raw as ClaudeHookPayload;

  const name = raw.hook_event_name;
  if (name === 'Stop' || name === 'SubagentStop') {
    // Carry cwd + session so the notification can deep-link to the transcript.
    return {
      event: 'stop',
      projectPath: typeof raw.cwd === 'string' ? raw.cwd : undefined,
      claudeSessionId: typeof raw.session_id === 'string' ? raw.session_id : undefined,
    };
  }
  if (name === 'Notification') {
    const msg: string = typeof raw.message === 'string' ? raw.message : '';
    // Permission notifications fire even when the request auto-resolves (allow
    // rules / bypass mode), so they're noisy and not reliably actionable — skip
    // them. Keep only the genuine "Claude is idle, waiting for you" nudge.
    if (/permission|approve|allow|grant/i.test(msg)) {
      return null;
    }
    return { event: 'idle_prompt', summary: msg || 'Waiting for your input' };
  }
  return null;
}
