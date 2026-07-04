import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TmuxSessionInfo } from '@crc/shared';

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
    return stdout
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
        };
      });
  } catch {
    return [];
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
