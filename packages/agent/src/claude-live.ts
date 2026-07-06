import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Claude Code (2.x) tracks each RUNNING interactive session in
// ~/.claude/sessions/<pid>.json — cwd, live status, and the chat name
// (auto-generated, overridden by /rename). Files for dead processes linger,
// so entries are filtered by a signal-0 liveness check.
const LIVE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

export interface LiveClaudeSession {
  pid: number;
  cwd: string;
  name?: string;
  status?: string;
  updatedAt?: number;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getLiveClaudeSessions(): LiveClaudeSession[] {
  let files: string[];
  try {
    files = fs.readdirSync(LIVE_SESSIONS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out: LiveClaudeSession[] = [];
  for (const f of files) {
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(LIVE_SESSIONS_DIR, f), 'utf-8'));
      if (typeof obj?.pid !== 'number' || !isAlive(obj.pid)) continue;
      out.push({
        pid: obj.pid,
        cwd: typeof obj.cwd === 'string' ? obj.cwd : '',
        name: typeof obj.name === 'string' ? obj.name : undefined,
        status: typeof obj.status === 'string' ? obj.status : undefined,
        updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : undefined,
      });
    } catch {
      // unreadable/corrupt entry — skip
    }
  }
  // Oldest-updated first, so when two Claudes share a tmux session the most
  // recently active one wins the (last-write) assignment.
  out.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  return out;
}

/** Snapshot of pid -> ppid for ancestry walks. Empty map on failure. */
export async function getPidParents(): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid='], { timeout: 5000 });
    for (const line of stdout.split('\n')) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (m) map.set(parseInt(m[1], 10), parseInt(m[2], 10));
    }
  } catch {
    // ps unavailable — callers fall back to cwd matching
  }
  return map;
}

export function isDescendantOf(
  pid: number,
  ancestor: number,
  parents: Map<number, number>
): boolean {
  let cur: number | undefined = pid;
  for (let i = 0; i < 25 && cur !== undefined && cur > 1; i++) {
    if (cur === ancestor) return true;
    cur = parents.get(cur);
  }
  return false;
}
