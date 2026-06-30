import type { SessionStatus, TerminalSession } from '@crc/shared';
import { SESSION_MAX_PER_AGENT } from '@crc/shared';
import { logger } from './logger.js';

interface SessionEntry {
  id: string;
  agentId: string;
  name: string;
  status: SessionStatus;
  clientSocketId: string | null;
  agentSocketId: string;
  cols: number;
  rows: number;
  createdAt: number;
  lastAttachedAt: number;
}

const sessions = new Map<string, SessionEntry>();
let sessionCounter = new Map<string, number>();

export function createSession(
  sessionId: string,
  agentId: string,
  clientSocketId: string,
  agentSocketId: string,
  name: string | undefined,
  cols: number,
  rows: number
): boolean {
  const agentSessions = getSessionsForAgent(agentId);
  if (agentSessions.length >= SESSION_MAX_PER_AGENT) return false;

  const count = (sessionCounter.get(agentId) || 0) + 1;
  sessionCounter.set(agentId, count);

  const now = Date.now();
  sessions.set(sessionId, {
    id: sessionId,
    agentId,
    name: name || `Session ${count}`,
    status: 'attached',
    clientSocketId,
    agentSocketId,
    cols,
    rows,
    createdAt: now,
    lastAttachedAt: now,
  });
  logger.info({ sessionId, agentId, name: name || `Session ${count}` }, 'Session created');
  return true;
}

export function attachSession(
  sessionId: string,
  clientSocketId: string,
  cols: number,
  rows: number
): string | null {
  const entry = sessions.get(sessionId);
  if (!entry || entry.status === 'dead') return null;

  const oldClientSocketId = entry.clientSocketId;
  entry.clientSocketId = clientSocketId;
  entry.status = 'attached';
  entry.cols = cols;
  entry.rows = rows;
  entry.lastAttachedAt = Date.now();
  logger.info({ sessionId }, 'Session attached');
  return oldClientSocketId;
}

export function detachSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  entry.clientSocketId = null;
  entry.status = 'detached';
  logger.info({ sessionId }, 'Session detached');
}

export function killSession(sessionId: string): SessionEntry | undefined {
  const entry = sessions.get(sessionId);
  if (entry) {
    sessions.delete(sessionId);
    logger.info({ sessionId }, 'Session killed');
  }
  return entry;
}

export function renameSession(sessionId: string, name: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  entry.name = name;
  return true;
}

export function getSession(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId);
}

export function getSessionsForAgent(agentId: string): TerminalSession[] {
  const result: TerminalSession[] = [];
  for (const entry of sessions.values()) {
    if (entry.agentId === agentId) {
      result.push({
        id: entry.id,
        agentId: entry.agentId,
        name: entry.name,
        status: entry.status,
        cols: entry.cols,
        rows: entry.rows,
        createdAt: entry.createdAt,
        lastAttachedAt: entry.lastAttachedAt,
      });
    }
  }
  return result;
}

export function reconcileSessions(agentId: string, aliveIds: string[]): string[] {
  const aliveSet = new Set(aliveIds);
  const deadSessionIds: string[] = [];
  for (const [sessionId, entry] of sessions) {
    if (entry.agentId === agentId && !aliveSet.has(sessionId)) {
      deadSessionIds.push(sessionId);
      sessions.delete(sessionId);
    }
  }
  if (deadSessionIds.length > 0) {
    logger.info({ agentId, deadCount: deadSessionIds.length }, 'Reconciled dead sessions');
  }
  return deadSessionIds;
}

/**
 * Agent socket dropped: keep every session entry alive but mark it detached and
 * forget the (now dead) agent socket, so a transient reconnect can re-adopt the
 * still-running PTYs instead of orphaning them. Does NOT delete.
 */
export function detachAgentSessions(agentId: string): SessionEntry[] {
  const affected: SessionEntry[] = [];
  for (const entry of sessions.values()) {
    if (entry.agentId === agentId) {
      entry.status = 'detached';
      entry.agentSocketId = '';
      affected.push(entry);
    }
  }
  if (affected.length > 0) {
    logger.info({ agentId, count: affected.length }, 'Agent sessions detached (awaiting reconnect)');
  }
  return affected;
}

/**
 * Agent gone for good (grace window elapsed without reconnect, or PTYs reported
 * dead on reconnect): remove the entries and return them so attached clients can
 * be notified.
 */
export function killAgentSessions(agentId: string): SessionEntry[] {
  const affected: SessionEntry[] = [];
  for (const [sessionId, entry] of sessions) {
    if (entry.agentId === agentId) {
      affected.push({ ...entry });
      sessions.delete(sessionId);
    }
  }
  sessionCounter.delete(agentId);
  if (affected.length > 0) {
    logger.info({ agentId, count: affected.length }, 'Agent sessions killed');
  }
  return affected;
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

export function updateAgentSocketId(agentId: string, newSocketId: string): void {
  for (const entry of sessions.values()) {
    if (entry.agentId === agentId) {
      entry.agentSocketId = newSocketId;
      // Revive detached sessions: a client that stayed connected is attached
      // again; otherwise the session waits detached for a client to reattach.
      if (entry.status === 'detached') {
        entry.status = entry.clientSocketId ? 'attached' : 'detached';
      }
    }
  }
}
