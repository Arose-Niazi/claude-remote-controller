import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

// On POSIX, node-pty forks a bundled `spawn-helper` binary to set up the
// controlling terminal. npm/pnpm frequently strip its execute bit on install
// (and macOS may quarantine a downloaded prebuild), and node-pty does NOT
// re-chmod it — so pty.fork() dies with "posix_spawnp failed" and every
// terminal/tmux session fails. Self-heal at startup: make every bundled
// spawn-helper executable and clear any quarantine flag. No-op on Windows
// (ConPTY, no helper binary).
export function ensurePtyHelperExecutable(): void {
  if (process.platform === 'win32') return;
  try {
    const nodeRequire = createRequire(__filename);
    const ptyMain = nodeRequire.resolve('node-pty'); // …/node-pty/lib/index.js
    const ptyDir = path.dirname(path.dirname(ptyMain)); // …/node-pty

    const candidates = [path.join(ptyDir, 'build', 'Release', 'spawn-helper')];
    const prebuilds = path.join(ptyDir, 'prebuilds');
    try {
      for (const d of fs.readdirSync(prebuilds)) {
        candidates.push(path.join(prebuilds, d, 'spawn-helper'));
      }
    } catch {
      /* no prebuilds dir on this install */
    }

    for (const file of candidates) {
      try {
        const mode = fs.statSync(file).mode;
        if (!(mode & 0o111)) {
          fs.chmodSync(file, mode | 0o755);
          logger.info({ file }, 'Restored execute bit on node-pty spawn-helper');
        }
      } catch {
        /* file absent for this arch — skip */
      }
    }

    // Best-effort: drop macOS quarantine that can block a downloaded prebuild.
    if (process.platform === 'darwin') {
      execFile('xattr', ['-dr', 'com.apple.quarantine', ptyDir], () => {});
    }
  } catch (err: any) {
    logger.warn({ error: err?.message }, 'Could not verify node-pty spawn-helper permissions');
  }
}
