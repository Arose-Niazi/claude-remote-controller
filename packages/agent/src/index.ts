import { io } from 'socket.io-client';
import {
  AGENT_HEARTBEAT,
  TERMINAL_OPEN,
  TERMINAL_INPUT,
  TERMINAL_RESIZE,
  TERMINAL_CLOSE,
  TERMINAL_OUTPUT,
  TERMINAL_EXIT,
  SESSION_SYNC,
  SESSION_SYNC_RESULT,
  SESSION_ATTACH,
  SESSION_DETACH,
  SESSION_BUFFER,
  HEARTBEAT_INTERVAL,
  type TerminalOpenPayload,
  type TerminalInputPayload,
  type TerminalResizePayload,
  type TerminalClosePayload,
  type SessionAttachPayload,
  type SessionDetachPayload,
} from '@crc/shared';

import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { buildHeartbeat } from './heartbeat.js';
import {
  createTerminalSession,
  writeToSession,
  resizeSession,
  closeSession,
  closeAllSessions,
  detachAllSessions,
  detachSession,
  attachSession,
  getAliveSessionIds,
} from './terminal-manager.js';

const config = loadConfig();
logger.info({ agentId: config.agentId, serverUrl: config.serverUrl }, 'Starting agent');

const socket = io(config.serverUrl + '/agent', {
  auth: { agentId: config.agentId, secret: config.secret },
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
  reconnectionAttempts: Infinity,
});

socket.on('connect', () => {
  logger.info('Connected to server');
  socket.emit(AGENT_HEARTBEAT, buildHeartbeat());
});

socket.on('connect_error', (err) => {
  logger.error({ error: err.message }, 'Connection error');
});

socket.on('disconnect', (reason) => {
  logger.warn({ reason }, 'Disconnected from server');
  // Do NOT kill sessions — just detach all so they keep buffering
  detachAllSessions();
});

// --- Heartbeat loop ---
setInterval(() => {
  if (socket.connected) {
    socket.emit(AGENT_HEARTBEAT, buildHeartbeat());
  }
}, HEARTBEAT_INTERVAL);

// --- Terminal event handlers ---
socket.on(TERMINAL_OPEN, (payload: TerminalOpenPayload) => {
  const { sessionId, cols, rows } = payload;
  if (!sessionId) return;

  createTerminalSession(
    sessionId,
    cols,
    rows,
    config.shell,
    config.homeDir,
    (sid, data) => {
      socket.emit(TERMINAL_OUTPUT, { sessionId: sid, data });
    },
    (sid, exitCode) => {
      socket.emit(TERMINAL_EXIT, { sessionId: sid, exitCode });
    }
  );
});

socket.on(TERMINAL_INPUT, (payload: TerminalInputPayload) => {
  writeToSession(payload.sessionId, payload.data);
});

socket.on(TERMINAL_RESIZE, (payload: TerminalResizePayload) => {
  resizeSession(payload.sessionId, payload.cols, payload.rows);
});

socket.on(TERMINAL_CLOSE, (payload: TerminalClosePayload) => {
  closeSession(payload.sessionId);
});

// --- Session lifecycle handlers ---
socket.on(SESSION_SYNC, () => {
  const aliveIds = getAliveSessionIds();
  socket.emit(SESSION_SYNC_RESULT, { sessionIds: aliveIds });
  logger.info({ count: aliveIds.length }, 'Session sync responded');
});

socket.on(SESSION_ATTACH, (payload: SessionAttachPayload) => {
  const buffered = attachSession(payload.sessionId, payload.cols, payload.rows);
  if (buffered) {
    socket.emit(SESSION_BUFFER, { sessionId: payload.sessionId, data: buffered });
  }
});

socket.on(SESSION_DETACH, (payload: SessionDetachPayload) => {
  detachSession(payload.sessionId);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  closeAllSessions();
  socket.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  closeAllSessions();
  socket.disconnect();
  process.exit(0);
});
