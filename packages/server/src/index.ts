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
  type HeartbeatPayload,
  type TerminalOutputPayload,
  type TerminalExitPayload,
  type TerminalOpenPayload,
  type TerminalInputPayload,
  type TerminalResizePayload,
  type TerminalClosePayload,
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
  findAgentBySocketId,
} from './agent-registry.js';
import {
  createSession,
  getSession,
  removeSession,
  getSessionsByClientSocket,
  getSessionsByAgentSocket,
} from './terminal-relay.js';

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
  // Only serve index.html for non-API routes (SPA fallback)
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
  broadcastAgents();

  socket.on(AGENT_HEARTBEAT, (payload: HeartbeatPayload) => {
    updateHeartbeat(agentId, payload);
    broadcastAgents();
  });

  socket.on(TERMINAL_OUTPUT, (payload: TerminalOutputPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    clientNs.to(session.clientSocketId).emit(TERMINAL_OUTPUT, payload);
  });

  socket.on(TERMINAL_EXIT, (payload: TerminalExitPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    clientNs.to(session.clientSocketId).emit(TERMINAL_EXIT, payload);
    removeSession(payload.sessionId);
  });

  socket.on('disconnect', () => {
    // Clean up all terminal sessions for this agent
    const sessionIds = getSessionsByAgentSocket(socket.id);
    for (const sid of sessionIds) {
      const session = getSession(sid);
      if (session) {
        clientNs.to(session.clientSocketId).emit(TERMINAL_EXIT, { sessionId: sid, exitCode: -1 });
        removeSession(sid);
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

  // Send current agent list on connect
  socket.emit(AGENTS_UPDATE, getAgentList());

  socket.on(TERMINAL_OPEN, (payload: TerminalOpenPayload) => {
    const { agentId, cols, rows } = payload;
    if (!agentId) return;

    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) {
      socket.emit(TERMINAL_EXIT, { sessionId: '', exitCode: -1 });
      return;
    }

    const sessionId = uuid();
    createSession(sessionId, agentId, socket.id, agentSocketId);

    // Forward open command to agent
    agentNs.to(agentSocketId).emit(TERMINAL_OPEN, { sessionId, cols, rows });

    // Tell client the session is ready
    socket.emit(TERMINAL_READY, { sessionId });
  });

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

  socket.on(TERMINAL_CLOSE, (payload: TerminalClosePayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    agentNs.to(session.agentSocketId).emit(TERMINAL_CLOSE, payload);
    removeSession(payload.sessionId);
  });

  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Client disconnected');
    // Clean up all terminal sessions for this client
    const sessionIds = getSessionsByClientSocket(socket.id);
    for (const sid of sessionIds) {
      const session = getSession(sid);
      if (session) {
        agentNs.to(session.agentSocketId).emit(TERMINAL_CLOSE, { sessionId: sid });
        removeSession(sid);
      }
    }
  });
});

function broadcastAgents(): void {
  clientNs.emit(AGENTS_UPDATE, getAgentList());
}

// --- Start ---
httpServer.listen(config.port, () => {
  logger.info({ port: config.port }, 'CRC server started');
});
