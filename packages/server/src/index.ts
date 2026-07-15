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
  CLAUDE_NOTIFY,
  TMUX_LIST,
  TMUX_LIST_RESULT,
  TMUX_KILL,
  TMUX_KILL_RESULT,
  TMUX_SCROLL,
  AGENT_EXEC,
  AGENT_EXEC_RESULT,
  type FilesListPayload,
  type FilesListResultPayload,
  type FilesDownloadPayload,
  type FilesDownloadReadyPayload,
  type FilesDownloadErrorPayload,
  type VpnListPayload,
  type VpnConnectPayload,
  type VpnDisconnectPayload,
  type VpnUpdatePayload,
  type ClaudeSessionsListPayload,
  type ClaudeSessionsResultPayload,
  type ClaudeConvReadPayload,
  type ClaudeConvDataPayload,
  type ClaudeHookPayload,
  type TmuxListPayload,
  type TmuxListResultPayload,
  type TmuxKillPayload,
  type TmuxKillResultPayload,
  type TmuxScrollPayload,
  type AgentExecPayload,
  type AgentExecResultPayload,
} from '@crc/shared';

import { config } from './config.js';
import { logger } from './logger.js';
import { verifyToken } from './auth.js';
import { authenticateAgent, getOwner as agentStoreGetOwner } from './agents-store.js';
import { resolveTokenUser } from './users.js';
import { requireUser } from './auth-middleware.js';
import {
  registerAgent,
  updateHeartbeat,
  unregisterAgent,
  getAgentListForUser,
  getAgentOwnerId,
  getAgentSocketId,
  setAgentsChangedListener,
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
  detachAgentSessions,
  killAgentSessions,
  reconcileSessions,
  updateAgentSocketId,
} from './terminal-relay.js';
import { startCleanupInterval } from './file-store.js';

import authRoutes from './routes/auth.routes.js';
import agentRoutes from './routes/agent.routes.js';
import fileRoutes from './routes/file.routes.js';
import pushRoutes from './routes/push.routes.js';
import { initPush, sendPushToUser } from './push.js';
import { runMigration } from './migration.js';

const app = express();
// Behind Nginx: trust the first proxy hop so req.ip is the real client address.
app.set('trust proxy', 1);
const httpServer = createServer(app);

// Security headers on every response.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Parse JSON for every route EXCEPT the file upload/receive endpoints, which read
// the raw request body as a stream. A global express.json() would consume (and
// 100kb-cap) application/json uploads, hanging or rejecting JSON-typed files.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/files')) {
    next();
    return;
  }
  express.json()(req, res, next);
});

// --- One-shot RPC correlation ------------------------------------------------
// FILES_LIST / FILES_DOWNLOAD / AGENT_EXEC are request/response over the relay.
// We map each requestId to the requesting client's socket so the agent's result
// is delivered ONLY to that client, instead of broadcast to everyone.
const pendingRpc = new Map<string, { socketId: string; agentId: string; at: number }>();
function trackRpc(requestId: string, socketId: string, agentId: string): void {
  pendingRpc.set(requestId, { socketId, agentId, at: Date.now() });
}
// Deliver a result only if the responding agent is the one the request targeted
// (which the requester provably owns). Otherwise return null → owner-room
// fallback. Prevents a client-chosen requestId from mis-routing another user's
// result (file bytes, exec stdout) to the wrong socket.
function resolveRpc(requestId: string | undefined, respondingAgentId: string): string | null {
  if (!requestId) return null;
  const entry = pendingRpc.get(requestId);
  if (!entry) return null;
  pendingRpc.delete(requestId);
  return entry.agentId === respondingAgentId ? entry.socketId : null;
}
// Reap RPCs whose result never came back (agent offline mid-request, etc.).
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [id, entry] of pendingRpc) {
    if (entry.at < cutoff) pendingRpc.delete(id);
  }
}, 60_000).unref();

// --- Agent reconnect grace ---------------------------------------------------
// When an agent socket drops we keep its sessions alive (detached) for a grace
// window so a transient reconnect re-adopts the live PTYs. If it doesn't return
// in time, the sessions are killed and attached clients are notified.
const agentGraceTimers = new Map<string, NodeJS.Timeout>();
const AGENT_RECONNECT_GRACE_MS = 90_000;

// --- REST routes ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/auth', authRoutes);

// Auth middleware for protected routes — attaches req.userId / req.role.
app.use('/api/agents', requireUser, agentRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/push', pushRoutes);

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
    origin:
      config.allowedOrigins.length > 0
        ? config.allowedOrigins
        : config.nodeEnv === 'development'
          ? '*'
          : undefined,
  },
  transports: ['websocket', 'polling'],
});

// Agent namespace
const agentNs = io.of('/agent');

agentNs.use((socket, next) => {
  const { agentId, secret } = socket.handshake.auth;
  const ownerUserId = agentId && secret ? authenticateAgent(agentId, secret) : null;
  if (!agentId || !secret || !ownerUserId) {
    next(new Error('Authentication failed'));
    return;
  }
  const data = socket.data as { agentId: string; ownerUserId: string };
  data.agentId = agentId;
  data.ownerUserId = ownerUserId;
  next();
});

agentNs.on('connection', (socket) => {
  const data = socket.data as { agentId: string; ownerUserId: string };
  const agentId = data.agentId;
  const ownerUserId = data.ownerUserId;

  // The agent came back: cancel any pending grace cleanup for it.
  const graceTimer = agentGraceTimers.get(agentId);
  if (graceTimer) {
    clearTimeout(graceTimer);
    agentGraceTimers.delete(agentId);
  }

  // Capture the prior socket id BEFORE we overwrite the registry below.
  const staleSocketId = getAgentSocketId(agentId);

  // Register FIRST so the registry already points at this new socket. Only then
  // evict the stale socket — its synchronous disconnect handler will see that it
  // is no longer the current socket and no-op, instead of wiping the live agent.
  registerAgent(agentId, socket.id, ownerUserId);
  updateAgentSocketId(agentId, socket.id);

  if (staleSocketId && staleSocketId !== socket.id) {
    const staleSocket = agentNs.sockets.get(staleSocketId);
    if (staleSocket) {
      logger.info({ agentId, staleSocketId }, 'Evicting stale agent socket on re-register');
      staleSocket.disconnect(true);
    }
  }

  // Ask the agent which PTYs are still alive so we can reconcile.
  socket.emit(SESSION_SYNC);

  // For sessions a client is still attached to, ask the agent to flush its ring
  // buffer so a transient reconnect resumes seamlessly.
  for (const s of getSessionsForAgent(agentId)) {
    if (getSession(s.id)?.clientSocketId) {
      socket.emit(SESSION_ATTACH, { sessionId: s.id, cols: s.cols, rows: s.rows });
    }
  }

  emitAgentsToUser(ownerUserId);
  emitSessionsForAgent(agentId);

  socket.on(AGENT_HEARTBEAT, (payload: HeartbeatPayload) => {
    updateHeartbeat(agentId, payload);
    emitAgentsToUser(ownerUserId);
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
    emitSessionsForAgent(agentId);
  });

  socket.on(TERMINAL_OUTPUT, (payload: TerminalOutputPayload) => {
    const session = getSession(payload.sessionId);
    if (!session || !session.clientSocketId) return;
    clientNs.to(session.clientSocketId).emit(TERMINAL_OUTPUT, payload);
  });

  socket.on(TERMINAL_EXIT, (payload: TerminalExitPayload) => {
    const session = getSession(payload.sessionId);
    // Broadcast to the owner's clients (not just attached) so notification listeners fire
    clientNs.to(userRoom(ownerUserId)).emit(TERMINAL_EXIT, {
      ...payload,
      sessionName: session?.name,
      agentId: session?.agentId ?? agentId,
    });
    killSession(payload.sessionId);
    if (session) emitSessionsForAgent(session.agentId);
  });

  // --- VPN relay (agent -> client) ---
  socket.on(VPN_UPDATE, (payload: VpnUpdatePayload) => {
    clientNs.to(userRoom(ownerUserId)).emit(VPN_UPDATE, { agentId, profiles: payload.profiles });
  });

  // --- File explorer relay (agent -> client) ---
  // Deliver only to the client that made the request (tracked by requestId).
  socket.on(FILES_LIST_RESULT, (payload: FilesListResultPayload) => {
    const enriched = { ...payload, agentId };
    const target = resolveRpc(payload.requestId, agentId);
    if (target) clientNs.to(target).emit(FILES_LIST_RESULT, enriched);
    else clientNs.to(userRoom(ownerUserId)).emit(FILES_LIST_RESULT, enriched);
  });

  socket.on(FILES_DOWNLOAD_READY, (payload: FilesDownloadReadyPayload) => {
    const enriched = { ...payload, agentId };
    const target = resolveRpc(payload.requestId, agentId);
    if (target) clientNs.to(target).emit(FILES_DOWNLOAD_READY, enriched);
    else clientNs.to(userRoom(ownerUserId)).emit(FILES_DOWNLOAD_READY, enriched);
  });

  socket.on(FILES_DOWNLOAD_ERROR, (payload: FilesDownloadErrorPayload) => {
    const enriched = { ...payload, agentId };
    const target = resolveRpc(payload.requestId, agentId);
    if (target) clientNs.to(target).emit(FILES_DOWNLOAD_ERROR, enriched);
    else clientNs.to(userRoom(ownerUserId)).emit(FILES_DOWNLOAD_ERROR, enriched);
  });

  // --- Claude sessions relay (agent -> client) ---
  socket.on(CLAUDE_SESSIONS_RESULT, (payload: ClaudeSessionsResultPayload) => {
    clientNs.to(userRoom(ownerUserId)).emit(CLAUDE_SESSIONS_RESULT, { ...payload, agentId });
  });

  // --- Claude conversation relay (agent -> client) ---
  socket.on(CLAUDE_CONV_DATA, (payload: ClaudeConvDataPayload) => {
    clientNs.to(userRoom(ownerUserId)).emit(CLAUDE_CONV_DATA, { ...payload, agentId });
  });

  // --- Claude hook events -> Web Push + in-app toast (works even when Claude
  //     runs outside a CRC terminal, e.g. in Warp/tmux) ---
  socket.on(CLAUDE_HOOK, (payload: ClaudeHookPayload) => {
    const { title, body } = describeClaudeHook(payload);
    if (!title) return; // prompt_submit / tool_complete are informational
    clientNs.to(userRoom(ownerUserId)).emit(CLAUDE_NOTIFY, { agentId, event: payload.event, title, body });
    // Deep-link the push: to the transcript view when we know the project, else
    // to the agent's session screen.
    let url = `/sessions/${agentId}`;
    if (payload.projectPath) {
      url = `/conversation/${agentId}?project=${encodeURIComponent(payload.projectPath)}`;
      if (payload.claudeSessionId) url += `&session=${encodeURIComponent(payload.claudeSessionId)}`;
    }
    void sendPushToUser(ownerUserId, { title, body, tag: `claude-${payload.event}`, agentId, url });
  });

  // --- tmux session list relay (agent -> requesting client) ---
  socket.on(TMUX_LIST_RESULT, (payload: TmuxListResultPayload) => {
    const enriched = { ...payload, agentId };
    const target = resolveRpc(payload.requestId, agentId);
    if (target) clientNs.to(target).emit(TMUX_LIST_RESULT, enriched);
    else clientNs.to(userRoom(ownerUserId)).emit(TMUX_LIST_RESULT, enriched);
  });

  socket.on(TMUX_KILL_RESULT, (payload: TmuxKillResultPayload) => {
    const enriched = { ...payload, agentId };
    const target = resolveRpc(payload.requestId, agentId);
    if (target) clientNs.to(target).emit(TMUX_KILL_RESULT, enriched);
    else clientNs.to(userRoom(ownerUserId)).emit(TMUX_KILL_RESULT, enriched);
  });

  // --- Agent exec relay (agent -> client) ---
  socket.on(AGENT_EXEC_RESULT, (payload: AgentExecResultPayload) => {
    const enriched = { ...payload, agentId };
    const target = resolveRpc(payload.requestId, agentId);
    if (target) clientNs.to(target).emit(AGENT_EXEC_RESULT, enriched);
    else clientNs.to(userRoom(ownerUserId)).emit(AGENT_EXEC_RESULT, enriched);
  });

  socket.on(SESSION_BUFFER, (payload: SessionBufferPayload) => {
    const session = getSession(payload.sessionId);
    if (!session || !session.clientSocketId) return;
    clientNs.to(session.clientSocketId).emit(SESSION_BUFFER, payload);
  });

  socket.on('disconnect', () => {
    // Only tear down the agent entry if THIS socket is still the active one.
    // Otherwise a late disconnect from a stale duplicate socket (same agentId
    // but older socketId) would wipe the entry for the live agent.
    const currentSocketId = getAgentSocketId(agentId);
    if (currentSocketId !== socket.id) {
      logger.info(
        { agentId, socketId: socket.id, currentSocketId },
        'Stale agent socket disconnected — keeping registry entry'
      );
      return;
    }
    // Keep the sessions alive but detached so a transient drop doesn't orphan the
    // agent's PTYs. Clients keep them listed (status 'detached'); we do NOT emit
    // SESSION_DETACHED yet, giving the agent a grace window to reconnect.
    detachAgentSessions(agentId);
    unregisterAgent(agentId);
    emitAgentsToUser(ownerUserId);
    emitSessionsForAgent(agentId);

    const existing = agentGraceTimers.get(agentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      agentGraceTimers.delete(agentId);
      if (getAgentSocketId(agentId)) return; // reconnected in time
      const killed = killAgentSessions(agentId);
      for (const entry of killed) {
        if (entry.clientSocketId) {
          clientNs.to(entry.clientSocketId).emit(SESSION_DETACHED, {
            sessionId: entry.id,
            reason: 'agent disconnected',
          });
        }
      }
      emitSessionsForAgent(agentId);
    }, AGENT_RECONNECT_GRACE_MS);
    timer.unref();
    agentGraceTimers.set(agentId, timer);
  });
});

// Client namespace
const clientNs = io.of('/client');

clientNs.use((socket, next) => {
  const { token } = socket.handshake.auth;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    next(new Error('Authentication failed'));
    return;
  }
  const resolved = resolveTokenUser(payload);
  if (!resolved) {
    next(new Error('Authentication failed'));
    return;
  }
  const data = socket.data as { userId: string; role: string };
  data.userId = resolved.userId;
  data.role = resolved.role;
  next();
});

clientNs.on('connection', (socket) => {
  const userId = (socket.data as { userId: string; role: string }).userId;
  logger.info({ socketId: socket.id, userId }, 'Client connected');
  socket.join(userRoom(userId));
  socket.emit(AGENTS_UPDATE, getAgentListForUser(userId));

  // --- Session lifecycle ---
  socket.on(SESSION_LIST, (payload: SessionListPayload) => {
    if (!assertOwnsAgent(userId, payload.agentId)) return;
    socket.emit(SESSIONS_UPDATE, getSessionsForAgent(payload.agentId));
  });

  socket.on(SESSION_CREATE, (payload: SessionCreatePayload) => {
    const { agentId, name, cols, rows, tmux, launch } = payload;
    if (!assertOwnsAgent(userId, agentId)) return;
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

    agentNs.to(agentSocketId).emit(TERMINAL_OPEN, { sessionId, cols, rows, tmux, launch });
    socket.emit(TERMINAL_READY, { sessionId });
    emitSessionsForAgent(agentId);
  });

  socket.on(SESSION_ATTACH, (payload: SessionAttachPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) {
      socket.emit(SESSION_DETACHED, { sessionId: payload.sessionId, reason: 'session not found' });
      return;
    }
    if (!assertOwnsAgent(userId, session.agentId)) return;

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
    emitSessionsForAgent(session.agentId);
  });

  socket.on(SESSION_DETACH, (payload: SessionDetachPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    if (!assertOwnsAgent(userId, session.agentId)) return;
    detachSession(payload.sessionId);
    agentNs.to(session.agentSocketId).emit(SESSION_DETACH, payload);
    emitSessionsForAgent(session.agentId);
  });

  socket.on(SESSION_RENAME, (payload: SessionRenamePayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    if (!assertOwnsAgent(userId, session.agentId)) return;
    renameSession(payload.sessionId, payload.name);
    emitSessionsForAgent(session.agentId);
  });

  socket.on(SESSION_KILL, (payload: SessionKillPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    if (!assertOwnsAgent(userId, session.agentId)) return;
    const agentId = session.agentId;
    agentNs.to(session.agentSocketId).emit(TERMINAL_CLOSE, { sessionId: payload.sessionId });
    killSession(payload.sessionId);
    emitSessionsForAgent(agentId);
  });

  socket.on(SESSION_KILL_ALL, (payload: SessionKillAllPayload) => {
    if (!assertOwnsAgent(userId, payload.agentId)) return;
    const sessions = getSessionsForAgent(payload.agentId);
    const agentSocketId = getAgentSocketId(payload.agentId);
    for (const s of sessions) {
      if (agentSocketId) {
        agentNs.to(agentSocketId).emit(TERMINAL_CLOSE, { sessionId: s.id });
      }
      killSession(s.id);
    }
    emitSessionsForAgent(payload.agentId);
  });

  // --- VPN relay (client -> agent) ---
  socket.on(VPN_LIST, (payload: VpnListPayload) => {
    if (!assertOwnsAgent(userId, payload.agentId)) return;
    const agentSocketId = getAgentSocketId(payload.agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(VPN_LIST, {});
  });

  socket.on(VPN_CONNECT, (payload: VpnConnectPayload) => {
    const { agentId, profileId } = payload;
    if (!agentId) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(VPN_CONNECT, { profileId });
  });

  socket.on(VPN_DISCONNECT, (payload: VpnDisconnectPayload) => {
    const { agentId, profileId } = payload;
    if (!agentId) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(VPN_DISCONNECT, { profileId });
  });

  // --- Claude conversation relay (client -> agent) ---
  socket.on(CLAUDE_CONV_READ, (payload: ClaudeConvReadPayload) => {
    const { agentId, ...rest } = payload;
    if (!agentId) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(CLAUDE_CONV_READ, rest);
  });

  // --- Claude sessions relay (client -> agent) ---
  socket.on(CLAUDE_SESSIONS_LIST, (payload: ClaudeSessionsListPayload) => {
    const { agentId, projectPath } = payload;
    if (!agentId) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (agentSocketId) agentNs.to(agentSocketId).emit(CLAUDE_SESSIONS_LIST, { projectPath });
  });

  // --- Agent exec relay (client -> agent) ---
  socket.on(AGENT_EXEC, (payload: AgentExecPayload) => {
    const { agentId, requestId, command, cwd } = payload;
    if (!agentId) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) return;
    const rid = requestId || uuid();
    trackRpc(rid, socket.id, agentId);
    agentNs.to(agentSocketId).emit(AGENT_EXEC, { requestId: rid, command, cwd });
  });

  // --- tmux session list (client -> agent) ---
  socket.on(TMUX_LIST, (payload: TmuxListPayload) => {
    const { agentId, requestId } = payload;
    if (!agentId) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) return;
    const rid = requestId || uuid();
    trackRpc(rid, socket.id, agentId);
    agentNs.to(agentSocketId).emit(TMUX_LIST, { requestId: rid });
  });

  // --- tmux session kill (client -> agent) ---
  socket.on(TMUX_KILL, (payload: TmuxKillPayload) => {
    const { agentId, name, requestId } = payload;
    if (!agentId || !name) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) return;
    const rid = requestId || uuid();
    trackRpc(rid, socket.id, agentId);
    agentNs.to(agentSocketId).emit(TMUX_KILL, { requestId: rid, name });
  });

  // --- tmux scroll (client -> agent) ---
  socket.on(TMUX_SCROLL, (payload: TmuxScrollPayload) => {
    const { agentId, sessionId, direction } = payload;
    if (!agentId || !sessionId || !direction) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) return;
    agentNs.to(agentSocketId).emit(TMUX_SCROLL, { sessionId, direction });
  });

  // --- File explorer relay (client -> agent) ---
  socket.on(FILES_LIST, (payload: FilesListPayload) => {
    const { agentId, path: dirPath, requestId } = payload;
    if (!agentId) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) return;
    const rid = requestId || uuid();
    trackRpc(rid, socket.id, agentId);
    agentNs.to(agentSocketId).emit(FILES_LIST, { requestId: rid, path: dirPath });
  });

  socket.on(FILES_DOWNLOAD, (payload: FilesDownloadPayload) => {
    const { agentId, path: filePath, requestId } = payload;
    if (!agentId) return;
    if (!assertOwnsAgent(userId, agentId)) return;
    const agentSocketId = getAgentSocketId(agentId);
    if (!agentSocketId) return;
    const rid = requestId || uuid();
    trackRpc(rid, socket.id, agentId);
    agentNs.to(agentSocketId).emit(FILES_DOWNLOAD, { requestId: rid, path: filePath });
  });

  // --- Terminal I/O ---
  socket.on(TERMINAL_INPUT, (payload: TerminalInputPayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    if (!assertOwnsAgent(userId, session.agentId)) return;
    agentNs.to(session.agentSocketId).emit(TERMINAL_INPUT, payload);
  });

  socket.on(TERMINAL_RESIZE, (payload: TerminalResizePayload) => {
    const session = getSession(payload.sessionId);
    if (!session) return;
    if (!assertOwnsAgent(userId, session.agentId)) return;
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

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Map a raw Claude hook event to a user-facing title/body. Returns an empty
// title for informational events that should not notify.
function describeClaudeHook(p: ClaudeHookPayload): { title: string; body: string } {
  switch (p.event) {
    case 'stop': {
      const folder = p.projectPath
        ? p.projectPath.split(/[\\/]/).filter(Boolean).pop() || ''
        : '';
      const what = p.response ? trunc(p.response, 150) : 'ready for your next prompt';
      return {
        title: folder ? `Claude finished — ${folder}` : 'Claude finished',
        body: what,
      };
    }
    case 'idle_prompt':
      return { title: 'Claude is waiting', body: p.summary || 'Ready for your next prompt' };
    case 'permission_request':
      return { title: 'Claude needs permission', body: p.summary || 'Waiting for your approval' };
    default:
      return { title: '', body: '' };
  }
}

// --- Per-user broadcast scoping ---------------------------------------------
// Every client joins a room 'user:<userId>' on connect; agent->client fan-out is
// scoped to the OWNER's room so a user only ever sees their own agents/sessions.
const userRoom = (userId: string): string => 'user:' + userId;

function emitAgentsToUser(userId: string): void {
  clientNs.to(userRoom(userId)).emit(AGENTS_UPDATE, getAgentListForUser(userId));
}

// Resolve the owning userId for an agent, preferring the live registry and
// falling back to the persistent agents store (e.g. agent currently offline).
function ownerOf(agentId: string): string | undefined {
  return getAgentOwnerId(agentId) ?? agentStoreGetOwner(agentId);
}

function emitSessionsForAgent(agentId: string): void {
  const owner = ownerOf(agentId);
  if (owner) clientNs.to(userRoom(owner)).emit(SESSIONS_UPDATE, getSessionsForAgent(agentId));
}

// Ownership gate for every client->agent handler. Returns false unless the
// requesting user owns the target agent.
function assertOwnsAgent(userId: string | undefined, agentId: string): boolean {
  return !!userId && ownerOf(agentId) === userId;
}

// --- Start ---
// First-boot migration: seed the admin user from ADMIN_PASSWORD and adopt legacy
// env AGENTS as admin-owned so the existing single-user deployment keeps working.
runMigration();
// Push agent-list changes that originate inside the registry (heartbeat timeout).
setAgentsChangedListener((ownerUserId: string) => emitAgentsToUser(ownerUserId));
startCleanupInterval();
initPush();

httpServer.listen(config.port, () => {
  logger.info({ port: config.port }, 'CRC server started');
});
