import { exec } from 'child_process';
import { promisify } from 'util';
import type { TmuxSessionInfo } from '@crc/shared';

const execAsync = promisify(exec);

/**
 * List tmux sessions on this machine so the phone can mirror one (the same
 * session the user has open in Warp). Returns an empty list if tmux isn't
 * installed or there's no server running.
 */
export async function listTmuxSessions(): Promise<TmuxSessionInfo[]> {
  try {
    const fmt = '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_activity}';
    const { stdout } = await execAsync(`tmux list-sessions -F '${fmt}'`, {
      timeout: 5000,
      env: { ...process.env },
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
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
    // No tmux server / tmux not installed → nothing to mirror.
    return [];
  }
}

/** Shell-quote a value for safe single-quoted interpolation. */
function shq(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the command a PTY runs to attach (or create) a shared tmux session.
 * `-A` attaches if it exists, else creates it (running `launch` if given).
 * aggressive-resize keeps the PC's view from shrinking to the phone's size.
 */
export function buildTmuxAttachCommand(name: string, launch?: string): string {
  let cmd = `tmux set-option -g aggressive-resize on 2>/dev/null; exec tmux new-session -A -s ${shq(name)}`;
  if (launch && launch.trim()) cmd += ` ${shq(launch.trim())}`;
  return cmd;
}
