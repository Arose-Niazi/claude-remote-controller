import { PtySession } from './pty-session.js';
import { logger } from './logger.js';

const sessions = new Map<string, PtySession>();

export function createTerminalSession(
  sessionId: string,
  cols: number,
  rows: number,
  shellPreference: string,
  onData: (sessionId: string, data: string) => void,
  onExit: (sessionId: string, exitCode: number) => void
): void {
  const session = new PtySession(sessionId, cols, rows, shellPreference);

  session.onData((data) => {
    onData(sessionId, data);
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

export function getActiveSessionCount(): number {
  return sessions.size;
}
