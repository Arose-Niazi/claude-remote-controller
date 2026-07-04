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

// One alert per task: install only the Stop hook ("Claude finished"). We also
// clean up any Notification/SubagentStop hooks earlier versions installed, so
// they stop firing the duplicate "waiting"/permission alerts.
const INSTALL_EVENTS = ['Stop'];
const MANAGED_EVENTS = ['Stop', 'Notification', 'SubagentStop'];

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
  for (const ev of MANAGED_EVENTS) {
    const existed = Array.isArray(hooks[ev]);
    const kept = (existed ? hooks[ev] : []).filter((g) => !isOurs(g));
    const next = INSTALL_EVENTS.includes(ev) ? [...kept, desired] : kept;
    const before = existed ? JSON.stringify(hooks[ev]) : '';
    if (next.length === 0) {
      if (existed) {
        delete hooks[ev];
        changed = true;
      }
    } else if (before !== JSON.stringify(next)) {
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
    logger.info({ install: INSTALL_EVENTS, url }, 'Installed CRC Claude notify hooks into settings.json (restart claude to apply)');
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
    // The response text is filled in later (after a small delay) so Claude has
    // finished flushing the final message to the transcript first.
    return {
      event: 'stop',
      projectPath: typeof raw.cwd === 'string' ? raw.cwd : undefined,
      claudeSessionId: typeof raw.session_id === 'string' ? raw.session_id : undefined,
    };
  }
  // Notification (idle / permission) is intentionally NOT notified — Stop
  // already covers "Claude is done and waiting", so this avoids duplicate alerts.
  return null;
}

/** Read the last assistant text message from a transcript JSONL for the notification body. */
export function lastAssistantSummary(transcriptPath?: string): string | undefined {
  if (!transcriptPath) return undefined;
  try {
    const lines = readFileSync(transcriptPath, 'utf-8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj?.type === 'assistant' && obj.message?.content) {
          const c = obj.message.content;
          const text = Array.isArray(c)
            ? c.filter((x: any) => x?.type === 'text').map((x: any) => x.text).join(' ')
            : typeof c === 'string' ? c : '';
          if (text.trim()) return text.trim().replace(/\s+/g, ' ').slice(0, 180);
        }
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* unreadable transcript */
  }
  return undefined;
}
