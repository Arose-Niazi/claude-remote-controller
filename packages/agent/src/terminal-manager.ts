import { PtySession } from './pty-session.js';
import { logger } from './logger.js';

const sessions = new Map<string, PtySession>();

export function createTerminalSession(
  sessionId: string,
  cols: number,
  rows: number,
  shellPreference: string,
  cwd: string | undefined,
  onData: (sessionId: string, data: string) => void,
  onExit: (sessionId: string, exitCode: number) => void,
  launch?: { file: string; args: string[] }
): void {
  const session = new PtySession(sessionId, cols, rows, shellPreference, cwd, launch);

  session.onData((data) => {
    session.appendToBuffer(data);
    if (session.isAttached()) {
      onData(sessionId, data);
    }
  });

  session.onExit((exit) => {
    sessions.delete(sessionId);
    onExit(sessionId, exit.exitCode);
    logger.info({ sessionId, exitCode: exit.exitCode }, 'PTY exited');
  });

  sessions.set(sessionId, session);
  logger.info({ sessionId, cols, rows }, 'PTY session created');
}

export function writeToSession(sessionId: string, data: string): void {
  sessions.get(sessionId)?.write(data);
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.resize(cols, rows);
}

export function detachSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.setAttached(false);
    logger.info({ sessionId }, 'PTY session detached');
  }
}

export function attachSession(sessionId: string, cols: number, rows: number): string {
  const session = sessions.get(sessionId);
  if (!session) return '';
  session.setAttached(true);
  session.resize(cols, rows);
  const buffered = session.getAndClearBuffer();
  logger.info({ sessionId, bufferSize: buffered.length }, 'PTY session reattached');
  return buffered;
}

export function closeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.kill();
    sessions.delete(sessionId);
    logger.info({ sessionId }, 'PTY session closed');
  }
}

export function closeAllSessions(): void {
  for (const [id, session] of sessions) {
    session.kill();
    logger.info({ sessionId: id }, 'PTY session force-closed');
  }
  sessions.clear();
}

export function detachAllSessions(): void {
  for (const [id, session] of sessions) {
    session.setAttached(false);
    logger.info({ sessionId: id }, 'PTY session detached (disconnect)');
  }
}

export function getAliveSessionIds(): string[] {
  return Array.from(sessions.keys());
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

// Kill and remove any detached sessions whose idle duration exceeds maxIdleMs.
// Returns the ids of the sessions that were reaped.
export function reapDetachedSessions(maxIdleMs: number): string[] {
  const now = Date.now();
  const reaped: string[] = [];
  for (const [id, session] of sessions) {
    if (session.isAttached()) continue;
    const detachedAt = session.getDetachedAt();
    if (detachedAt > 0 && now - detachedAt > maxIdleMs) {
      session.kill();
      sessions.delete(id);
      reaped.push(id);
      logger.info({ sessionId: id, idleMs: now - detachedAt }, 'PTY session reaped (idle)');
    }
  }
  return reaped;
}
