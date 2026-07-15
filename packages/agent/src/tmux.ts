import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { TmuxSessionInfo } from '@crc/shared';
import { getLiveClaudeSessions, getPidParents, isDescendantOf } from './claude-live.js';

const execFileAsync = promisify(execFile);

const IS_WIN = process.platform === 'win32';

let cachedTmuxPath: string | null | undefined;

/**
 * Absolute path to the tmux binary, resolved from the agent's PATH plus the
 * usual Homebrew/MacPorts locations a minimal (e.g. launchd/systemd) PATH
 * misses. Both listing AND launching go through this, so a session that shows
 * up in the list can always be attached — the previous split (list via the
 * agent's PATH, attach via a `zsh -l -c` login shell) meant a user who set
 * PATH in ~/.zshrc saw sessions that then failed to mirror with a blank pane.
 * Returns null only when tmux truly isn't installed.
 */
export function resolveTmuxPath(): string | null {
  if (cachedTmuxPath !== undefined) return cachedTmuxPath;
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const extra of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/opt/local/bin']) {
    if (!dirs.includes(extra)) dirs.push(extra);
  }
  for (const dir of dirs) {
    const candidate = path.join(dir, 'tmux');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      cachedTmuxPath = candidate;
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  cachedTmuxPath = null;
  return null;
}

// On Windows there's no native tmux, but WSL has it. Run tmux through the
// default WSL distro so we can mirror sessions the user runs in Warp's WSL tab.
// On POSIX use the absolute path (falls back to bare 'tmux') so listing and
// launching resolve identically.
function tmuxCmd(args: string[]): { file: string; args: string[] } {
  if (IS_WIN) return { file: 'wsl.exe', args: ['tmux', ...args] };
  return { file: resolveTmuxPath() || 'tmux', args };
}

/**
 * List tmux sessions so the phone can mirror one (the same session the user has
 * open in Warp / a WSL tab). Empty if tmux isn't available or no server runs.
 */
export async function listTmuxSessions(): Promise<TmuxSessionInfo[]> {
  const fmt = '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_activity}';
  const { file, args } = tmuxCmd(['list-sessions', '-F', fmt]);
  try {
    const { stdout } = await execFileAsync(file, args, { timeout: 6000 });
    const sessions = stdout
      .split('\n')
      .map((line) => line.replace(/\r$/, '').trim())
      .filter(Boolean)
      .map((line) => {
        const [name, windows, attached, activity] = line.split('\t');
        return {
          name,
          windows: parseInt(windows, 10) || 1,
          attached: attached === '1',
          activity: parseInt(activity, 10) || undefined,
        } as TmuxSessionInfo;
      });
    await enrichWithPanesAndClaude(sessions);
    return sessions;
  } catch {
    return [];
  }
}

/**
 * Kill a tmux session by exact name (`=` prefix disables tmux's
 * prefix-matching, so "claude" can never kill "claude-2"). Everything running
 * inside the session dies with it.
 */
export async function killTmuxSession(name: string): Promise<{ ok: boolean; error?: string }> {
  const { file, args } = tmuxCmd(['kill-session', '-t', `=${name}`]);
  try {
    await execFileAsync(file, args, { timeout: 6000 });
    return { ok: true };
  } catch (err: any) {
    const msg = (err?.stderr || err?.message || 'tmux kill failed').toString().trim();
    return { ok: false, error: msg };
  }
}

/**
 * Scroll a mirrored tmux session's pane via copy-mode — the only way to reach
 * tmux history from an attached client (its alt-screen bypasses xterm's own
 * scrollback). Returns whether the pane ends IN copy-mode, so the caller knows
 * to auto-exit before forwarding typed input. `=name` forces exact matching.
 */
export async function scrollTmux(
  name: string,
  direction: 'up' | 'down' | 'exit'
): Promise<{ inCopyMode: boolean }> {
  const bin = resolveTmuxPath();
  if (!bin) return { inCopyMode: false };
  const target = `=${name}`;
  const run = (args: string[]) => execFileAsync(bin, args, { timeout: 4000 }).catch(() => {});
  const inMode = async () => {
    try {
      const { stdout } = await execFileAsync(bin, ['display-message', '-t', target, '-p', '#{pane_in_mode}'], { timeout: 3000 });
      return stdout.trim() === '1';
    } catch {
      return false;
    }
  };

  if (direction === 'exit') {
    if (await inMode()) await run(['send-keys', '-t', target, '-X', 'cancel']);
    return { inCopyMode: false };
  }
  if (direction === 'up') {
    await run(['copy-mode', '-t', target]); // enter (or stay in) copy-mode
    await run(['send-keys', '-t', target, '-X', 'halfpage-up']);
    return { inCopyMode: true };
  }
  // down — only meaningful while scrolled up; auto-exit when back at the bottom
  if (!(await inMode())) return { inCopyMode: false };
  await run(['send-keys', '-t', target, '-X', 'halfpage-down']);
  try {
    const { stdout } = await execFileAsync(bin, ['display-message', '-t', target, '-p', '#{scroll_position}'], { timeout: 3000 });
    if ((parseInt(stdout.trim(), 10) || 0) === 0) {
      await run(['send-keys', '-t', target, '-X', 'cancel']);
      return { inCopyMode: false };
    }
  } catch {
    /* leave in copy-mode */
  }
  return { inCopyMode: true };
}

interface PaneInfo {
  session: string;
  pid: number;
  path: string;
  active: boolean;
}

/**
 * Attach each session's cwd and, when a live Claude Code runs inside it, the
 * chat name (/rename-able) + status from ~/.claude/sessions. Claude PIDs are
 * matched to sessions by walking their ancestry up to a pane PID, with a cwd
 * fallback. Best-effort: any failure leaves the base listing untouched.
 * Skipped on Windows — tmux lives in WSL there, whose PID space and home
 * directory don't line up with the host's ~/.claude.
 */
async function enrichWithPanesAndClaude(sessions: TmuxSessionInfo[]): Promise<void> {
  if (IS_WIN || sessions.length === 0) return;
  try {
    const paneFmt = '#{session_name}\t#{pane_pid}\t#{pane_current_path}\t#{window_active}#{pane_active}';
    const { file, args } = tmuxCmd(['list-panes', '-a', '-F', paneFmt]);
    const { stdout } = await execFileAsync(file, args, { timeout: 6000 });
    const panes: PaneInfo[] = stdout
      .split('\n')
      .map((line) => line.replace(/\r$/, '').trim())
      .filter(Boolean)
      .map((line) => {
        const [session, pid, path, activeFlags] = line.split('\t');
        return { session, pid: parseInt(pid, 10) || 0, path: path || '', active: activeFlags === '11' };
      });

    const byName = new Map(sessions.map((s) => [s.name, s]));
    for (const pane of panes) {
      const s = byName.get(pane.session);
      if (s && (!s.path || pane.active)) s.path = pane.path || s.path;
    }

    const live = getLiveClaudeSessions();
    if (live.length === 0) return;
    const parents = await getPidParents();
    for (const cs of live) {
      // cwd fallback only when the ps snapshot failed — with ancestry data
      // available, a non-match means the Claude simply isn't in tmux.
      const target = parents.size > 0
        ? panes.find((p) => p.pid > 0 && isDescendantOf(cs.pid, p.pid, parents))
        : panes.find((p) => cs.cwd && p.path === cs.cwd);
      if (!target) continue;
      const s = byName.get(target.session);
      if (!s) continue;
      s.claudeTitle = cs.name;
      s.claudeStatus = cs.status;
      if (cs.cwd) s.path = cs.cwd;
    }
  } catch {
    // enrichment is optional — base listing already populated
  }
}

/**
 * Build the process a PTY runs to attach (or create) a shared tmux session.
 * `-A` attaches if it exists, else creates it (running `launch` if given).
 *
 * POSIX: spawn the tmux binary DIRECTLY via its absolute path (resolveTmuxPath,
 * the same resolution listing uses) rather than through a `shell -l -c`
 * wrapper. The old wrapper depended on the login shell's PATH, which misses
 * tmux when the user configured PATH in ~/.zshrc (not ~/.zprofile) — the
 * session listed fine but mirroring spawned a dead pane. tmux inherits the
 * agent's env, so a `launch` command (e.g. `cd … && exec claude`) still finds
 * claude on the agent's PATH. Returns null when tmux isn't installed, so the
 * caller can show a real error instead of a blank canvas.
 */
export function buildTmuxLaunch(
  name: string,
  launch: string | undefined
): { file: string; args: string[] } | null {
  const trimmed = launch && launch.trim() ? launch.trim() : undefined;

  if (IS_WIN) {
    // wsl.exe tmux new-session -A -s <name> [launch]
    const args = ['tmux', 'new-session', '-A', '-s', name];
    if (trimmed) args.push(trimmed);
    return { file: 'wsl.exe', args };
  }

  const tmuxBin = resolveTmuxPath();
  if (!tmuxBin) return null;

  // Best-effort: keep the PC's view from shrinking to the phone's size.
  execFileAsync(tmuxBin, ['set-option', '-g', 'aggressive-resize', 'on'], { timeout: 4000 }).catch(
    () => {}
  );

  const args = ['new-session', '-A', '-s', name];
  if (trimmed) args.push(trimmed);
  return { file: tmuxBin, args };
}
