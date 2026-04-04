// --- Core ---

export interface AgentCapabilities {
  terminal: boolean;
  fileTransfer: boolean;
}

export interface AgentInfo {
  id: string;
  name: string;
  hostname: string;
  platform: 'win32' | 'darwin';
  arch: string;
  status: 'online' | 'offline';
  cpuUsage: number;
  memoryUsage: number;
  uptime: number;
  activeSessions: number;
  lastSeen: number;
  pathSeparator: '\\' | '/';
  homeDirectory: string;
  rootPaths: string[];
  capabilities: AgentCapabilities;
}

export type SessionStatus = 'attached' | 'detached' | 'dead';

export interface TerminalSession {
  id: string;
  agentId: string;
  name: string;
  status: SessionStatus;
  cols: number;
  rows: number;
  createdAt: number;
  lastAttachedAt: number;
}

export interface HeartbeatPayload {
  hostname: string;
  platform: 'win32' | 'darwin';
  arch: string;
  cpuUsage: number;
  memoryUsage: number;
  uptime: number;
  activeSessions: number;
  pathSeparator: '\\' | '/';
  homeDirectory: string;
  rootPaths: string[];
  capabilities: AgentCapabilities;
}

// --- File Explorer ---

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modified: number;
}

// --- File Transfer ---

export interface TransferInfo {
  fileId: string;
  fileName: string;
  size: number;
  downloadUrl: string;
  expiresAt: number;
  direction: 'to-agent' | 'to-phone';
  status: 'ready' | 'downloaded' | 'expired';
}
