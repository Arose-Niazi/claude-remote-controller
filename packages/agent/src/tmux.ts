import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TmuxSessionInfo } from '@crc/shared';
import { getLiveClaudeSessions, getPidParents, isDescendantOf } from './claude-live.js';

const execFileAsync = promisify(execFile);

const IS_WIN = process.platform === 'win32';

// On Windows there's no native tmux, but WSL has it. Run tmux through the
// default WSL distro so we can mirror sessions the user runs in Warp's WSL tab.
function tmuxCmd(args: string[]): { file: string; args: string[] } {
  return IS_WIN ? { file: 'wsl.exe', args: ['tmux', ...args] } : { file: 'tmux', args };
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

/** Shell-quote a value for safe single-quoted interpolation. */
function shq(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the process a PTY runs to attach (or create) a shared tmux session.
 * `-A` attaches if it exists, else creates it (running `launch` if given).
 * Returns a {file, args} spec spawned directly (no wrapping shell).
 */
export function buildTmuxLaunch(
  name: string,
  launch: string | undefined,
  shell: string
): { file: string; args: string[] } {
  const trimmed = launch && launch.trim() ? launch.trim() : undefined;

  if (IS_WIN) {
    // wsl.exe tmux new-session -A -s <name> [launch]
    const args = ['tmux', 'new-session', '-A', '-s', name];
    if (trimmed) args.push(trimmed);
    return { file: 'wsl.exe', args };
  }

  // POSIX: run via a login shell so PATH (e.g. Homebrew tmux) is loaded, and
  // set aggressive-resize so the PC's view doesn't shrink to the phone's size.
  let cmd = `tmux set-option -g aggressive-resize on 2>/dev/null; exec tmux new-session -A -s ${shq(name)}`;
  if (trimmed) cmd += ` ${shq(trimmed)}`;
  return { file: shell, args: ['-l', '-c', cmd] };
}
