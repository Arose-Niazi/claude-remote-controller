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
  FILES_LIST,
  FILES_LIST_RESULT,
  FILES_DOWNLOAD,
  FILES_DOWNLOAD_READY,
  VPN_LIST,
  VPN_CONNECT,
  VPN_DISCONNECT,
  VPN_UPDATE,
  CLAUDE_SESSIONS_LIST,
  CLAUDE_SESSIONS_RESULT,
  AGENT_EXEC,
  AGENT_EXEC_RESULT,
  HEARTBEAT_INTERVAL,
  type TerminalOpenPayload,
  type TerminalInputPayload,
  type TerminalResizePayload,
  type TerminalClosePayload,
  type SessionAttachPayload,
  type SessionDetachPayload,
  type FilesListPayload,
  type FilesDownloadPayload,
  type VpnConnectPayload,
  type VpnDisconnectPayload,
  type ClaudeSessionsListPayload,
  type AgentExecPayload,
} from '@crc/shared';

import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { buildHeartbeat } from './heartbeat.js';
import { listDirectory, downloadFile } from './file-explorer.js';
import { getProfiles, connectVpn, disconnectVpn } from './vpn-manager.js';
import { listClaudeSessions } from './claude-sessions.js';
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
  socket.emit(AGENT_HEARTBEAT, buildHeartbeat(config.homeDir));
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
    socket.emit(AGENT_HEARTBEAT, buildHeartbeat(config.homeDir));
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

// --- File explorer handlers ---
socket.on(FILES_LIST, (payload: FilesListPayload) => {
  const { requestId, path: dirPath } = payload;
  if (!requestId) return;
  const result = listDirectory(dirPath);
  socket.emit(FILES_LIST_RESULT, {
    requestId,
    path: dirPath,
    entries: result.entries,
    error: result.error,
  });
});

socket.on(FILES_DOWNLOAD, async (payload: FilesDownloadPayload) => {
  const { requestId, path: filePath } = payload;
  if (!requestId) return;
  const result = await downloadFile(filePath, config.serverUrl, config.secret, config.agentId);
  if ('error' in result) {
    logger.error({ requestId, error: result.error }, 'File download failed');
    return;
  }
  socket.emit(FILES_DOWNLOAD_READY, {
    requestId,
    fileId: result.fileId,
    fileName: result.fileName,
    downloadUrl: result.downloadUrl,
    size: result.size,
  });
});

// --- VPN handlers ---
const vpnProfiles = config.vpn?.profiles || [];

socket.on(VPN_LIST, async () => {
  const profiles = await getProfiles(vpnProfiles);
  socket.emit(VPN_UPDATE, { profiles });
});

socket.on(VPN_CONNECT, async (payload: VpnConnectPayload) => {
  const profiles = await connectVpn(vpnProfiles, payload.profileId);
  socket.emit(VPN_UPDATE, { profiles });
});

socket.on(VPN_DISCONNECT, async (payload: VpnDisconnectPayload) => {
  const profiles = await disconnectVpn(vpnProfiles, payload.profileId);
  socket.emit(VPN_UPDATE, { profiles });
});

// --- Agent exec handler (one-shot commands like git pull) ---
socket.on(AGENT_EXEC, async (payload: AgentExecPayload) => {
  const { requestId, command, cwd } = payload;
  if (!requestId) return;
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: 30000 });
    socket.emit(AGENT_EXEC_RESULT, { requestId, stdout: stdout || '', stderr: stderr || '' });
  } catch (err: any) {
    socket.emit(AGENT_EXEC_RESULT, {
      requestId,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      error: err.message,
    });
  }
});

// --- Claude Sessions handler ---
socket.on(CLAUDE_SESSIONS_LIST, async (payload: ClaudeSessionsListPayload) => {
  const sessions = await listClaudeSessions(payload.projectPath);
  socket.emit(CLAUDE_SESSIONS_RESULT, { sessions });
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
