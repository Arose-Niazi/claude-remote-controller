import type { AgentInfo, HeartbeatPayload } from '@crc/shared';
import { HEARTBEAT_TIMEOUT } from '@crc/shared';
import { logger } from './logger.js';

interface AgentEntry {
  socketId: string;
  info: AgentInfo;
  lastHeartbeat: number;
  timeoutHandle: NodeJS.Timeout;
}

const agents = new Map<string, AgentEntry>();

// Invoked whenever the agent list changes in a way clients should hear about
// (currently: a heartbeat-timeout flipping an agent offline). index.ts wires
// this to broadcastAgents so the change is pushed to connected clients.
let agentsChangedListener: (() => void) | null = null;
export function setAgentsChangedListener(cb: () => void): void {
  agentsChangedListener = cb;
}

export function registerAgent(agentId: string, socketId: string): void {
  const existing = agents.get(agentId);
  if (existing) {
    clearTimeout(existing.timeoutHandle);
  }

  const info: AgentInfo = {
    id: agentId,
    name: agentId,
    hostname: '',
    platform: 'win32',
    arch: '',
    status: 'online',
    cpuUsage: 0,
    memoryUsage: 0,
    uptime: 0,
    activeSessions: 0,
    lastSeen: Date.now(),
    pathSeparator: '\\',
    homeDirectory: '',
    rootPaths: [],
    capabilities: { terminal: true, fileTransfer: false },
  };

  const timeoutHandle = createTimeout(agentId);
  agents.set(agentId, { socketId, info, lastHeartbeat: Date.now(), timeoutHandle });
  logger.info({ agentId, socketId }, 'Agent registered');
}

export function updateHeartbeat(agentId: string, payload: HeartbeatPayload): void {
  const entry = agents.get(agentId);
  if (!entry) return;

  clearTimeout(entry.timeoutHandle);
  entry.lastHeartbeat = Date.now();
  entry.info = {
    ...entry.info,
    hostname: payload.hostname,
    platform: payload.platform,
    arch: payload.arch,
    cpuUsage: payload.cpuUsage,
    memoryUsage: payload.memoryUsage,
    uptime: payload.uptime,
    activeSessions: payload.activeSessions,
    status: 'online',
    lastSeen: Date.now(),
    pathSeparator: payload.pathSeparator,
    homeDirectory: payload.homeDirectory,
    rootPaths: payload.rootPaths,
    capabilities: payload.capabilities,
  };
  entry.timeoutHandle = createTimeout(agentId);
}

export function unregisterAgent(agentId: string): void {
  const entry = agents.get(agentId);
  if (entry) {
    clearTimeout(entry.timeoutHandle);
    agents.delete(agentId);
    logger.info({ agentId }, 'Agent unregistered');
  }
}

export function getAgentSocketId(agentId: string): string | undefined {
  return agents.get(agentId)?.socketId;
}

export function getAgentList(): AgentInfo[] {
  return Array.from(agents.values()).map((e) => e.info);
}

export function findAgentBySocketId(socketId: string): string | undefined {
  for (const [agentId, entry] of agents) {
    if (entry.socketId === socketId) return agentId;
  }
  return undefined;
}

function createTimeout(agentId: string): NodeJS.Timeout {
  return setTimeout(() => {
    const entry = agents.get(agentId);
    if (entry) {
      entry.info.status = 'offline';
      logger.warn({ agentId }, 'Agent heartbeat timeout');
      // Push the offline status to clients — without this they keep showing the
      // agent online on a half-open socket and open sessions that never respond.
      agentsChangedListener?.();
    }
  }, HEARTBEAT_TIMEOUT);
}
