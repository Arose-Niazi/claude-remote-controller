#!/usr/bin/env node
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
  FILES_DOWNLOAD_ERROR,
  VPN_LIST,
  VPN_CONNECT,
  VPN_DISCONNECT,
  VPN_UPDATE,
  CLAUDE_SESSIONS_LIST,
  CLAUDE_SESSIONS_RESULT,
  CLAUDE_CONV_READ,
  CLAUDE_CONV_DATA,
  CLAUDE_HOOK,
  TMUX_LIST,
  TMUX_LIST_RESULT,
  TMUX_KILL,
  TMUX_KILL_RESULT,
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
  type ClaudeConvReadPayload,
  type ClaudeHookPayload,
  type TmuxListPayload,
  type TmuxKillPayload,
  type AgentExecPayload,
} from '@crc/shared';

import { loadConfig, isConfigured, LOCAL_CONTROL_PORT } from './config.js';
import { logger } from './logger.js';
import { installClaudeHooks, normalizeClaudeHook, lastAssistantSummary } from './claude-plugin-installer.js';
import { startLocalControl } from './local-control.js';
import { ensurePtyHelperExecutable } from './pty-helper-fix.js';
import { listTmuxSessions, buildTmuxLaunch, killTmuxSession } from './tmux.js';
import { buildHeartbeat } from './heartbeat.js';
import { listDirectory, downloadFile } from './file-explorer.js';
import { getProfiles, connectVpn, disconnectVpn } from './vpn-manager.js';
import { listClaudeSessions } from './claude-sessions.js';
import { readConversation } from './claude-conversation.js';
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
  reapDetachedSessions,
} from './terminal-manager.js';

if (!isConfigured()) {
  console.error('No agent configured. Run: crc-agent setup');
  process.exit(1);
}

const config = loadConfig();
logger.info({ agentId: config.agentId, serverUrl: config.serverUrl }, 'Starting agent');

// node-pty's spawn-helper often loses its execute bit on npm install — restore
// it before any PTY is spawned, or pty.fork() fails with "posix_spawnp failed".
ensurePtyHelperExecutable();

// --- Process-level safety nets: keep the agent (and its PTYs) alive on unexpected errors ---
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection (agent kept alive)');
});

process.on('uncaughtException', (err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Uncaught exception (agent kept alive)');
});

// Install Claude Code notify hooks into ~/.claude/settings.json (idempotent).
// On Windows these run via Git Bash (when Git for Windows is installed).
installClaudeHooks(LOCAL_CONTROL_PORT);

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

// --- Detached session reaper: kill PTYs that have been detached longer than 6 hours ---
const SESSION_MAX_IDLE_MS = 6 * 60 * 60 * 1000;
const reaperInterval = setInterval(() => {
  const reaped = reapDetachedSessions(SESSION_MAX_IDLE_MS);
  if (reaped.length > 0) {
    logger.info({ sessionIds: reaped, count: reaped.length }, 'Reaped detached sessions');
  }
}, 60_000);
// Don't let the reaper keep the process alive on its own.
reaperInterval.unref();

// --- Local control endpoint: Claude Code notify hooks POST here (works even
//     when Claude runs in Warp/tmux, outside a CRC terminal) -> forward to the
//     server, which sends Web Push + an in-app toast. Pure loopback HTTP, so it
//     runs on every platform. ---
startLocalControl(LOCAL_CONTROL_PORT, (raw: ClaudeHookPayload) => {
  const payload = normalizeClaudeHook(raw);
  if (!payload) return;
  logger.info(
    { rawEvent: (raw as any)?.hook_event_name || (raw as any)?.event, mapped: payload.event, project: payload.projectPath || null },
    'Claude hook received'
  );

  const transcript = (raw as any)?.transcript_path;
  if (payload.event === 'stop' && typeof transcript === 'string') {
    // Give Claude ~600ms to finish flushing the final assistant message to the
    // transcript before we read it (otherwise we grab the PREVIOUS response).
    setTimeout(() => {
      payload.response = lastAssistantSummary(transcript);
      if (socket.connected) socket.emit(CLAUDE_HOOK, payload);
    }, 600);
  } else if (socket.connected) {
    socket.emit(CLAUDE_HOOK, payload);
  }
});

// --- Terminal event handlers ---
socket.on(TERMINAL_OPEN, (payload: TerminalOpenPayload) => {
  const { sessionId, cols, rows, tmux, launch } = payload;
  if (!sessionId) return;

  // If a tmux session was requested, attach (or create) it so the session is
  // shared with Warp/tmux on the PC (via WSL on Windows, native tmux elsewhere).
  let launchSpec: { file: string; args: string[] } | undefined;
  if (tmux) {
    const spec = buildTmuxLaunch(tmux, launch);
    if (!spec) {
      // tmux isn't installed — show a readable error instead of a blank pane.
      const msg =
        '\r\n\x1b[31mtmux is not installed on this machine.\x1b[0m\r\n' +
        'Install it to use tmux mirroring:\r\n' +
        '  macOS:  brew install tmux\r\n' +
        '  Linux:  sudo apt install tmux  (or your package manager)\r\n\r\n';
      socket.emit(TERMINAL_OUTPUT, { sessionId, data: msg });
      socket.emit(TERMINAL_EXIT, { sessionId, exitCode: 1 });
      logger.warn({ sessionId, tmux }, 'tmux launch requested but tmux not found');
      return;
    }
    launchSpec = spec;
  }

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
    },
    launchSpec
  );
});

// --- tmux session list ---
socket.on(TMUX_LIST, async (payload: TmuxListPayload) => {
  const { requestId } = payload;
  if (!requestId) return;
  try {
    const sessions = await listTmuxSessions();
    socket.emit(TMUX_LIST_RESULT, { requestId, sessions });
  } catch (err: any) {
    socket.emit(TMUX_LIST_RESULT, { requestId, sessions: [], error: err?.message || 'tmux list failed' });
  }
});

// --- tmux session kill ---
socket.on(TMUX_KILL, async (payload: TmuxKillPayload) => {
  const { requestId, name } = payload;
  if (!requestId || !name) return;
  const result = await killTmuxSession(name);
  logger.info({ name, ok: result.ok, error: result.error }, 'tmux kill requested');
  socket.emit(TMUX_KILL_RESULT, { requestId, name, ok: result.ok, error: result.error });
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
    socket.emit(FILES_DOWNLOAD_ERROR, { requestId, error: result.error });
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

// --- VPN handlers (disabled on Windows — requires admin) ---
const vpnProfiles = process.platform === 'win32' ? [] : (config.vpn?.profiles || []);

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

// --- Claude Conversation handler ---
socket.on(CLAUDE_CONV_READ, async (payload: ClaudeConvReadPayload) => {
  try {
    const result = await readConversation(payload.projectPath, payload.afterLine || 0, payload.sessionId);
    if (result) {
      socket.emit(CLAUDE_CONV_DATA, {
        sessionId: result.sessionId,
        messages: result.messages,
        totalLines: result.totalLines,
      });
    } else {
      socket.emit(CLAUDE_CONV_DATA, {
        sessionId: '',
        messages: [],
        totalLines: 0,
        error: 'No conversation found',
      });
    }
  } catch (err: any) {
    logger.error({ error: err?.message }, 'Failed to read conversation');
    socket.emit(CLAUDE_CONV_DATA, {
      sessionId: '',
      messages: [],
      totalLines: 0,
      error: err?.message || 'Failed to read conversation',
    });
  }
});

// --- Claude Sessions handler ---
socket.on(CLAUDE_SESSIONS_LIST, async (payload: ClaudeSessionsListPayload) => {
  try {
    const sessions = await listClaudeSessions(payload.projectPath);
    socket.emit(CLAUDE_SESSIONS_RESULT, { sessions });
  } catch (err: any) {
    logger.error({ error: err?.message }, 'Failed to list Claude sessions');
    socket.emit(CLAUDE_SESSIONS_RESULT, { sessions: [], error: err?.message || 'Failed to list sessions' });
  }
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
