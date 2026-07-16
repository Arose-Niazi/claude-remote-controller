import { spawn } from 'child_process';
import { logger } from './logger.js';

// Keep the Mac awake while the agent runs so the connection doesn't drop when
// the machine would otherwise idle-sleep (a sleeping Mac suspends networking
// and the agent disconnects).
//
// Uses `caffeinate -i` — prevents IDLE system sleep only:
//   • the display can still sleep (saves battery),
//   • closing the lid or an explicit sleep STILL sleeps the machine,
//   • locking the screen keeps the agent running.
// The assertion is tied to our PID (`-w`), so macOS releases it automatically
// when the agent exits — even on crash or kill. No lingering assertion.
//
// macOS only. Set CRC_ALLOW_SLEEP=1 to opt out.
export function keepAwake(): void {
  if (process.platform !== 'darwin') return;
  if (process.env.CRC_ALLOW_SLEEP === '1') return;
  try {
    const child = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      logger.warn(
        { error: (err as Error).message },
        'Could not start caffeinate — the Mac may idle-sleep and drop the connection'
      );
    });
    child.unref();
    logger.info('Preventing idle sleep while the agent runs (caffeinate -i)');
  } catch (err: any) {
    logger.warn({ error: err?.message }, 'Could not prevent idle sleep');
  }
}
