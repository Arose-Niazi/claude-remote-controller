import { logger } from './logger.js';

interface SessionEntry {
  agentId: string;
  clientSocketId: string;
  agentSocketId: string;
}

const sessions = new Map<string, SessionEntry>();

export function createSession(
  sessionId: string,
  agentId: string,
  clientSocketId: string,
  agentSocketId: string
): void {
  sessions.set(sessionId, { agentId, clientSocketId, agentSocketId });
  logger.info({ sessionId, agentId }, 'Terminal session created');
}

export function getSession(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId);
}

export function removeSession(sessionId: string): void {
  if (sessions.delete(sessionId)) {
    logger.info({ sessionId }, 'Terminal session removed');
  }
}

export function getSessionsByClientSocket(clientSocketId: string): string[] {
  const result: string[] = [];
  for (const [sessionId, entry] of sessions) {
    if (entry.clientSocketId === clientSocketId) result.push(sessionId);
  }
  return result;
}

export function getSessionsByAgentSocket(agentSocketId: string): string[] {
  const result: string[] = [];
  for (const [sessionId, entry] of sessions) {
    if (entry.agentSocketId === agentSocketId) result.push(sessionId);
  }
  return result;
}

export function getActiveSessionCount(agentId: string): number {
  let count = 0;
  for (const entry of sessions.values()) {
    if (entry.agentId === agentId) count++;
  }
  return count;
}
