import { io } from 'socket.io-client';
import {
  AGENT_HEARTBEAT,
  TERMINAL_OPEN,
  TERMINAL_INPUT,
  TERMINAL_RESIZE,
  TERMINAL_CLOSE,
  TERMINAL_OUTPUT,
  TERMINAL_EXIT,
  HEARTBEAT_INTERVAL,
  type TerminalOpenPayload,
  type TerminalInputPayload,
  type TerminalResizePayload,
  type TerminalClosePayload,
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
  // Send initial heartbeat
  socket.emit(AGENT_HEARTBEAT, buildHeartbeat());
});

socket.on('connect_error', (err) => {
  logger.error({ error: err.message }, 'Connection error');
});

socket.on('disconnect', (reason) => {
  logger.warn({ reason }, 'Disconnected from server');
  closeAllSessions();
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
