import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuid } from 'uuid';
import path from 'path';

import {
  AGENT_HEARTBEAT,
  TERMINAL_OUTPUT,
  TERMINAL_EXIT,
  TERMINAL_OPEN,
  TERMINAL_INPUT,
  TERMINAL_RESIZE,
  TERMINAL_CLOSE,
  AGENTS_UPDATE,
  TERMINAL_READY,
  SESSION_LIST,
  SESSION_CREATE,
  SESSION_ATTACH,
  SESSION_DETACH,
  SESSION_RENAME,
  SESSION_KILL,
  SESSION_KILL_ALL,
  SESSIONS_UPDATE,
  SESSION_BUFFER,
  SESSION_DETACHED,
  SESSION_SYNC,
  SESSION_SYNC_RESULT,
  type HeartbeatPayload,
  type TerminalOutputPayload,
  type TerminalExitPayload,
  type TerminalInputPayload,
  type TerminalResizePayload,
  type TerminalClosePayload,
  type SessionCreatePayload,
  type SessionAttachPayload,
  type SessionDetachPayload,
  type SessionRenamePayload,
  type SessionKillPayload,
  type SessionKillAllPayload,
  type SessionListPayload,
  type SessionSyncResultPayload,
  type SessionBufferPayload,
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
  CLAUDE_CONV_READ,
  CLAUDE_CONV_DATA,
  AGENT_EXEC,
  AGENT_EXEC_RESULT,
  type FilesListPayload,
  type FilesListResultPayload,
  type FilesDownloadPayload,
  type FilesDownloadReadyPayload,
  type VpnListPayload,
  type VpnConnectPayload,
  type VpnDisconnectPayload,
  type VpnUpdatePayload,
  type ClaudeSessionsListPayload,
  type ClaudeSessionsResultPayload,
  type ClaudeConvReadPayload,
  type ClaudeConvDataPayload,
  type AgentExecPayload,
  type AgentExecResultPayload,
} from '@crc/shared';

import { config } from './config.js';
import { logger } from './logger.js';
import { verifyToken, validateAgentAuth } from './auth.js';
import {
  registerAgent,
  updateHeartbeat,
  unregisterAgent,
  getAgentList,
  getAgentSocketId,
} from './agent-registry.js';
import {
  createSession,
  attachSession,
  detachSession,
  killSession,
  renameSession,
  getSession,
  getSessionsForAgent,
  getSessionsByClientSocket,
  markAgentSessionsDead,
  reconcileSessions,
  updateAgentSocketId,
} from './terminal-relay.js';
import { startCleanupInterval } from './file-store.js';

import authRoutes from './routes/auth.routes.js';
import agentRoutes from './routes/agent.routes.js';
import fileRoutes from './routes/file.routes.js';

const app = express();
const httpServer = createServer(app);

app.use(express.json());

// --- REST routes ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/auth', authRoutes);

// Auth middleware for protected routes
app.use('/api/agents', (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  next();
});
app.use('/api/agents', agentRoutes);
app.use('/api/files', fileRoutes);

// Serve static web UI in production
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path.startsWith('/socket.io')) {
    next();
    return;
  }
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) next();
  });
});

// --- Socket.IO ---
const io = new Server(httpServer, {
  cors: {
    origin: config.nodeEnv === 'development' ? '*' : undefined,
  },
  transports: ['websocket', 'polling'],
});

// Agent namespace
const agentNs = io.of('/agent');

agentNs.use((socket, next) => {
  const { agentId, secret } = socket.handshake.auth;
  if (!agentId || !secret || !validateAgentAuth(agentId, secret)) {
    next(new Error('Authentication failed'));
    return;
  }
  (socket.data as { agentId: string }).agentId = agentId;
  next();
});

agentNs.on('connection', (socket) => {
  const agentId = (socket.data as { agentId: string }).agentId;
  registerAgent(agentId, socket.id);

  // Update socket IDs for existing sessions and request sync
  updateAgentSocketId(agentId, socket.id);
  socket.emit(SESSION_SYNC);

  broadcastAgents();

  socket.on(AGENT_HEARTBEAT, (payload: HeartbeatPayload) => {
    updateHeartbeat(agentId, payload);
    broadcastAgents();
  });

  socket.on(SESSION_SYNC_RESULT, (payload: SessionSyncResultPayload) => {
    const deadIds = reconcileSessions(agentId, payload.sessionIds);
    for (const sid of deadIds) {
      // Notify any attached clients that session is dead
      const entry = getSession(sid);
      if (entry?.clientSocketId) {
        clientNs.to(entry.clientSocketId).emit(SESSION_DETACHED, { sessionId: sid, reason: 'agent restarted' });
      }
    }
    // Broadcast updated session list
    broadcastSessionsForAgent(agentId);
  });

  socket.on(TERMINAL_OUTPUT, (payload: TerminalOutputPayload) => {
    const session = getSession(payload.sessionId);
    if (!session || !session.clientSocketId) return;
    clientNs.to(session.clientSocketId).emit(TERMINAL_OUTPUT, payload);
  });

  socket.on(TERMINAL_EXIT, (payload: TerminalExitPayload) => {
    const session = getSession(payload.sessionId);
    if (session?.clientSocketId) {
      clientNs.to(session.clientSocketId).emit(TERMINAL_EXIT, payload);
    }
    killSession(payload.sessionId);
    if (session) broadcastSessionsForAgent(session.agentId);
  });

  // --- VPN relay (agent -> client) ---
  socket.on(VPN_UPDATE, (payload: VpnUpdatePayload) => {
    clientNs.emit(VPN_UPDATE, { agentId, profiles: payload.profiles });
  });

  // --- File explorer relay (agent -> client) ---
  socket.on(FILES_LIST_RESULT, (payload: FilesListResultPayload) => {
    // Broadcast to all clients — the requestId lets them match
    clientNs.emit(FILES_LIST_RESULT, payload);
  });

  socket.on(FILES_DOWNLOAD_READY, (payload: FilesDownloadReadyPayload) => {
    clientNs.emit(FILES_DOWNLOAD_READY, payload);
  });

  // --- Claude sessions relay (agent -> client) ---
  socket.on(CLAUDE_SESSIONS_RESULT, (payload: ClaudeSessionsResultPayload) => {
    clientNs.emit(CLAUDE_SESSIONS_RESULT, { ...payload, agentId });
  });

  // --- Claude conversation relay (agent -> client) ---
  socket.on(CLAUDE_CONV_DATA, (payload: ClaudeConvDataPayload) => {
    clientNs.emit(CLAUDE_CONV_DATA, { ...payload, agentId });
  });

  // --- Agent exec relay (agent -> client) ---
  socket.on(AGENT_EXEC_RESULT, (payload: AgentExecResultPayload) => {
    clientNs.emit(AGENT_EXEC_RESULT, payload);
  });

  socket.on(SESSION_BUFFER, (payload: SessionBufferPayload) => {
    const session = getSession(payload.sessionId);
    if (!session || !session.clientSocketId) return;
    clientNs.to(session.clientSocketId).emit(SESSION_BUFFER, payload);
  });

  socket.on('disconnect', () => {
    // Mark all sessions dead and notify attached clients
    const deadSessions = markAgentSessionsDead(agentId);
    for (const entry of deadSessions) {
      if (entry.clientSocketId) {
        clientNs.to(entry.clientSocketId).emit(SESSION_DETACHED, {
          sessionId: entry.id,
          reason: 'agent disconnected',
        });
      }
    }
    unregisterAgent(agentId);
    broadcastAgents();
  });
});

// Client namespace
const clientNs = io.of('/client');

clientNs.use((socket, next) => {
  const { token } = socket.handshake.auth;
  if (!token || !verifyToken(token)) {
    next(new Error('Authentication failed'));
    return;
  }
  next();
});

clientNs.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Client connected');
  socket.emit(AGENTS_UPDATE, getAgentList());

  // --- Session lifecycle ---
  socket.on(SESSION_LIST, (payload: SessionListPayload) => {
    socket.emit(SESSIONS_UPDATE, getSessionsForAgent(payload.agentId));
  });

  socket.on(SESSION_CREATE, (payload: SessionCreatePayload) => {
    const { agentId, name, cols, rows } = payload;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) {
      socket.emit(SESSION_DETACHED, { sessionId: '', reason: 'agent offline' });
      return;
    }

    const sessionId = uuid();
    const created = createSession(sessionId, agentId, socket.id, agentSocketId, name, cols, rows);
    if (!created) {
      socket.emit(SESSION_DETACHED, { sessionId: '', reason: 'max sessions reached' });
      return;
    }

    agentNs.to(agentSocketId).emit(TERMINAL_OPEN, { sessionId, cols, rows });
    socket.emit(TERMINAL_READY, { sessionId });
    broadcastSessionsForAgent(agentId);
  });

  socket.on(SESSION_ATTACH, (payload: SessionAttachPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) {
      socket.emit(SESSION_DETACHED, { sessionId: payload.sessionId, reason: 'session not found' });
      return;
    }

    const oldClientSocketId = attachSession(payload.sessionId, socket.id, payload.cols, payload.rows);

    // Kick old client if still connected
    if (oldClientSocketId && oldClientSocketId !== socket.id) {
      clientNs.to(oldClientSocketId).emit(SESSION_DETACHED, {
        sessionId: payload.sessionId,
        reason: 'replaced',
      });
    }

    // Tell agent to flush buffer and reattach
    agentNs.to(session.agentSocketId).emit(SESSION_ATTACH, {
      sessionId: payload.sessionId,
      cols: payload.cols,
      rows: payload.rows,
    });

    socket.emit(TERMINAL_READY, { sessionId: payload.sessionId });
    broadcastSessionsForAgent(session.agentId);
  });

  socket.on(SESSION_DETACH, (payload: SessionDetachPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    detachSession(payload.sessionId);
    agentNs.to(session.agentSocketId).emit(SESSION_DETACH, payload);
    broadcastSessionsForAgent(session.agentId);
  });

  socket.on(SESSION_RENAME, (payload: SessionRenamePayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    renameSession(payload.sessionId, payload.name);
    broadcastSessionsForAgent(session.agentId);
  });

  socket.on(SESSION_KILL, (payload: SessionKillPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    const agentId = session.agentId;
    agentNs.to(session.agentSocketId).emit(TERMINAL_CLOSE, { sessionId: payload.sessionId });
    killSession(payload.sessionId);
    broadcastSessionsForAgent(agentId);
  });

  socket.on(SESSION_KILL_ALL, (payload: SessionKillAllPayload) => {
    const sessions = getSessionsForAgent(payload.agentId);
    const agentSocketId = getAgentSocketId(payload.agentId);
    for (const s of sessions) {
      if (agentSocketId) {
        agentNs.to(agentSocketId).emit(TERMINAL_CLOSE, { sessionId: s.id });
      }
      killSession(s.id);
    }
    broadcastSessionsForAgent(payload.agentId);
  });

  // --- VPN relay (client -> agent) ---
  socket.on(VPN_LIST, (payload: VpnListPayload) => {
    const agentSocketId = getAgentSocketId(payload.agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(VPN_LIST, {});
  });

  socket.on(VPN_CONNECT, (payload: VpnConnectPayload) => {
    const { agentId, profileId } = payload;
    if (!agentId) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(VPN_CONNECT, { profileId });
  });

  socket.on(VPN_DISCONNECT, (payload: VpnDisconnectPayload) => {
    const { agentId, profileId } = payload;
    if (!agentId) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(VPN_DISCONNECT, { profileId });
  });

  // --- Claude conversation relay (client -> agent) ---
  socket.on(CLAUDE_CONV_READ, (payload: ClaudeConvReadPayload) => {
    const { agentId, ...rest } = payload;
    if (!agentId) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(CLAUDE_CONV_READ, rest);
  });

  // --- Claude sessions relay (client -> agent) ---
  socket.on(CLAUDE_SESSIONS_LIST, (payload: ClaudeSessionsListPayload) => {
    const { agentId, projectPath } = payload;
    if (!agentId) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(CLAUDE_SESSIONS_LIST, { projectPath });
  });

  // --- Agent exec relay (client -> agent) ---
  socket.on(AGENT_EXEC, (payload: AgentExecPayload) => {
    const { agentId, ...rest } = payload;
    if (!agentId) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) {
      const { v4: uuid } = require('uuid');
      const requestId = uuid();
      agentNs.to(agentSocketId).emit(AGENT_EXEC, { ...rest, requestId });
    }
  });

  // --- File explorer relay (client -> agent) ---
  socket.on(FILES_LIST, (payload: FilesListPayload) => {
    const { agentId, path: dirPath } = payload;
    if (!agentId) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) return;
    const requestId = uuid();
    agentNs.to(agentSocketId).emit(FILES_LIST, { requestId, path: dirPath });
  });

  socket.on(FILES_DOWNLOAD, (payload: FilesDownloadPayload) => {
    const { agentId, path: filePath } = payload;
    if (!agentId) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) return;
    const requestId = uuid();
    agentNs.to(agentSocketId).emit(FILES_DOWNLOAD, { requestId, path: filePath });
  });

  // --- Terminal I/O (unchanged) ---
  socket.on(TERMINAL_INPUT, (payload: TerminalInputPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    agentNs.to(session.agentSocketId).emit(TERMINAL_INPUT, payload);
  });

  socket.on(TERMINAL_RESIZE, (payload: TerminalResizePayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    agentNs.to(session.agentSocketId).emit(TERMINAL_RESIZE, payload);
  });

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Client disconnected');
    // Detach all sessions (NOT kill) — sessions survive phone disconnect
    const sessionIds = getSessionsByClientSocket(socket.id);
    for (const sid of sessionIds) {
      const session = getSession(sid);
      if (session) {
        detachSession(sid);
        agentNs.to(session.agentSocketId).emit(SESSION_DETACH, { sessionId: sid });
      }
    }
  });
});

function broadcastAgents(): void {
  clientNs.emit(AGENTS_UPDATE, getAgentList());
}

function broadcastSessionsForAgent(agentId: string): void {
  clientNs.emit(SESSIONS_UPDATE, getSessionsForAgent(agentId));
}

// --- Start ---
startCleanupInterval();

httpServer.listen(config.port, () => {
  logger.info({ port: config.port }, 'CRC server started');
});
