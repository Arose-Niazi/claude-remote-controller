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

// --- VPN ---

export type VpnType = 'wireguard' | 'openvpn' | 'azure';
export type VpnStatus = 'connected' | 'disconnected' | 'connecting' | 'disconnecting' | 'error';

export interface VpnProfile {
  id: string;
  name: string;
  type: VpnType;
  status: VpnStatus;
  error?: string;
}

// --- File Explorer ---

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modified: number;
}

// --- Claude Sessions ---

export interface ClaudeSessionInfo {
  sessionId: string;
  projectPath: string;
  firstMessage: string;      // first user message (truncated)
  lastTimestamp: string;      // ISO 8601
  messageCount: number;
  model?: string;
  slug?: string;
  gitBranch?: string;
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
