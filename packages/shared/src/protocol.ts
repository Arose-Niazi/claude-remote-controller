// Socket.IO event names — the contract between all components

// --- Agent -> Server ---
export const AGENT_HEARTBEAT = 'agent:heartbeat' as const;
export const TERMINAL_OUTPUT = 'terminal:output' as const;
export const TERMINAL_EXIT = 'terminal:exit' as const;

// --- Server -> Agent ---
export const TERMINAL_OPEN = 'terminal:open' as const;
export const TERMINAL_INPUT = 'terminal:input' as const;
export const TERMINAL_RESIZE = 'terminal:resize' as const;
export const TERMINAL_CLOSE = 'terminal:close' as const;

// --- Server -> Client ---
export const AGENTS_UPDATE = 'agents:update' as const;
export const TERMINAL_READY = 'terminal:ready' as const;

// --- Session lifecycle events ---
// Client -> Server
export const SESSION_LIST = 'session:list' as const;
export const SESSION_CREATE = 'session:create' as const;
export const SESSION_ATTACH = 'session:attach' as const;
export const SESSION_DETACH = 'session:detach' as const;
export const SESSION_RENAME = 'session:rename' as const;
export const SESSION_KILL = 'session:kill' as const;
export const SESSION_KILL_ALL = 'session:killAll' as const;

// Server -> Client
export const SESSIONS_UPDATE = 'sessions:update' as const;
export const SESSION_BUFFER = 'session:buffer' as const;
export const SESSION_DETACHED = 'session:detached' as const;

// Server -> Agent
export const SESSION_SYNC = 'session:sync' as const;

// Agent -> Server
export const SESSION_SYNC_RESULT = 'session:sync:result' as const;

// --- VPN Events ---
// Client -> Server
export const VPN_LIST = 'vpn:list' as const;
export const VPN_CONNECT = 'vpn:connect' as const;
export const VPN_DISCONNECT = 'vpn:disconnect' as const;

// Server -> Client / Agent -> Server
export const VPN_UPDATE = 'vpn:update' as const;

// --- File Explorer Events ---
// Client -> Server
export const FILES_LIST = 'files:list' as const;
export const FILES_DOWNLOAD = 'files:download' as const;

// Server -> Agent / Agent -> Server
export const FILES_LIST_RESULT = 'files:list:result' as const;
export const FILES_DOWNLOAD_READY = 'files:download:ready' as const;

// --- Agent Exec (one-shot command) ---
// Client -> Server -> Agent
export const AGENT_EXEC = 'agent:exec' as const;
// Agent -> Server -> Client
export const AGENT_EXEC_RESULT = 'agent:exec:result' as const;

// --- Claude Conversation (live JSONL reading) ---
// Client -> Server -> Agent
export const CLAUDE_CONV_READ = 'claude:conv:read' as const;
// Agent -> Server -> Client
export const CLAUDE_CONV_DATA = 'claude:conv:data' as const;

// --- Claude Sessions Events ---
// Client -> Server
export const CLAUDE_SESSIONS_LIST = 'claude:sessions:list' as const;
// Agent -> Server -> Client
export const CLAUDE_SESSIONS_RESULT = 'claude:sessions:result' as const;

// --- File Events ---
export const FILE_READY = 'file:ready' as const;
export const FILE_EXPIRED = 'file:expired' as const;
export const FILE_GRAB = 'file:grab' as const;

// --- Payload types ---
export interface TerminalOutputPayload {
  sessionId: string;
  data: string;
}

export interface TerminalExitPayload {
  sessionId: string;
  exitCode: number;
}

export interface TerminalOpenPayload {
  sessionId?: string;
  agentId?: string;
  cols: number;
  rows: number;
}

export interface TerminalInputPayload {
  sessionId: string;
  data: string;
}

export interface TerminalResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalClosePayload {
  sessionId: string;
}

export interface TerminalReadyPayload {
  sessionId: string;
}

export interface SessionListPayload {
  agentId: string;
}

export interface SessionCreatePayload {
  agentId: string;
  name?: string;
  cols: number;
  rows: number;
}

export interface SessionAttachPayload {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface SessionDetachPayload {
  sessionId: string;
}

export interface SessionRenamePayload {
  sessionId: string;
  name: string;
}

export interface SessionKillPayload {
  sessionId: string;
}

export interface SessionKillAllPayload {
  agentId: string;
}

export interface SessionBufferPayload {
  sessionId: string;
  data: string;
}

export interface SessionDetachedPayload {
  sessionId: string;
  reason: string;
}

export interface SessionSyncResultPayload {
  sessionIds: string[];
}

// --- VPN Payloads ---

export interface VpnListPayload {
  agentId: string;
}

export interface VpnConnectPayload {
  agentId?: string;
  profileId: string;
}

export interface VpnDisconnectPayload {
  agentId?: string;
  profileId: string;
}

export interface VpnUpdatePayload {
  agentId?: string;
  profiles: import('./types.js').VpnProfile[];
}

// --- Agent Exec Payloads ---

export interface AgentExecPayload {
  agentId?: string;
  requestId?: string;
  command: string;
  cwd: string;
}

export interface AgentExecResultPayload {
  requestId: string;
  stdout: string;
  stderr: string;
  error?: string;
}

// --- Claude Conversation Payloads ---

export interface ClaudeConvMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  toolId?: string;
  timestamp?: string;
  model?: string;
}

export interface ClaudeConvReadPayload {
  agentId?: string;
  projectPath: string;
  sessionId?: string;
  afterLine?: number;
}

export interface ClaudeConvDataPayload {
  agentId?: string;
  sessionId: string;
  messages: ClaudeConvMessage[];
  totalLines: number;
  error?: string;
}

// --- Claude Sessions Payloads ---

export interface ClaudeSessionsListPayload {
  agentId?: string;
  projectPath?: string;       // optional: filter to one project. If omitted, list all.
}

export interface ClaudeSessionsResultPayload {
  agentId?: string;
  sessions: import('./types.js').ClaudeSessionInfo[];
  error?: string;
}

export interface FileGrabPayload {
  agentId: string;
  remotePath: string;
}

// --- File Explorer Payloads ---

export interface FilesListPayload {
  agentId?: string;
  requestId?: string;
  path: string;
}

export interface FilesListResultPayload {
  requestId: string;
  path: string;
  entries: import('./types.js').FileEntry[];
  error?: string;
}

export interface FilesDownloadPayload {
  agentId?: string;
  requestId?: string;
  path: string;
}

export interface FilesDownloadReadyPayload {
  requestId: string;
  fileId: string;
  fileName: string;
  downloadUrl: string;
  size: number;
}
