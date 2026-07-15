import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { CONFIG_DIR } from './config.js';
import { logger } from './logger.js';

// A PID lockfile so two agents can never run at once. Duplicate agents connect
// to the server under the SAME agentId; the server then routes terminal I/O to
// whichever socket registered last, so input can land on the wrong process and
// silently go nowhere. (This actually happened — a 9-day-old orphan shadowed a
// freshly-updated agent.) Set CRC_ALLOW_MULTIPLE=1 to bypass intentionally.
const LOCK_FILE = path.join(CONFIG_DIR, 'agent.lock');

function isRunningAgent(pid: number): boolean {
  try {
    process.kill(pid, 0); // throws if the pid is not alive
  } catch {
    return false;
  }
  if (process.platform === 'win32') return true; // can't easily inspect; assume yes
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    // Global bin: `node …/crc-agent` or `…/cli-remote-agent/dist/cli.js`.
    // Dev: `node …/packages/agent/dist/(cli|index).js`.
    return /crc-agent|cli-remote-agent|agent[\/\\](dist|src)[\/\\](cli|index)/.test(out);
  } catch {
    return true; // ps failed but the pid is alive — be conservative, treat as ours
  }
}

/**
 * Acquire the single-instance lock. Returns { ok: true } on success, or
 * { ok: false, pid } if another agent already holds it.
 */
export function acquireSingleInstanceLock(): { ok: boolean; pid?: number } {
  if (process.env.CRC_ALLOW_MULTIPLE === '1') return { ok: true };
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const prev = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      if (prev && prev !== process.pid && isRunningAgent(prev)) {
        return { ok: false, pid: prev };
      }
    }
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    const release = () => {
      try {
        if (parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10) === process.pid) {
          fs.unlinkSync(LOCK_FILE);
        }
      } catch {
        /* already gone */
      }
    };
    process.on('exit', release);
    return { ok: true };
  } catch (err: any) {
    // Never block startup on a lockfile problem — worst case we lose the guard.
    logger.warn({ error: err?.message }, 'Could not manage single-instance lock');
    return { ok: true };
  }
}
