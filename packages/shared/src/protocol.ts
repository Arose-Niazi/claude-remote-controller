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
export const FILES_DOWNLOAD_ERROR = 'files:download:error' as const;

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

// --- Claude hook events (from the agent's Claude Code hooks, fired even when
// Claude runs outside a CRC terminal — e.g. in Warp/tmux) ---
// Agent -> Server
export const CLAUDE_HOOK = 'claude:hook' as const;
// Server -> Client (in-app toast for connected clients; push covers closed apps)
export const CLAUDE_NOTIFY = 'claude:notify' as const;

// --- Shared tmux sessions (mirror what runs in Warp/tmux on the PC) ---
// Client -> Server -> Agent
export const TMUX_LIST = 'tmux:list' as const;
// Agent -> Server -> Client
export const TMUX_LIST_RESULT = 'tmux:list:result' as const;
// Client -> Server -> Agent
export const TMUX_KILL = 'tmux:kill' as const;
// Agent -> Server -> Client
export const TMUX_KILL_RESULT = 'tmux:kill:result' as const;

// --- Payload types ---
export interface TerminalOutputPayload {
  sessionId: string;
  data: string;
}

export interface TerminalExitPayload {
  sessionId: string;
  exitCode: number;
  sessionName?: string;
  agentId?: string;
}

export interface TerminalOpenPayload {
  sessionId?: string;
  agentId?: string;
  cols: number;
  rows: number;
  tmux?: string;
  launch?: string;
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
  // When set, the PTY attaches to (or creates) this tmux session instead of a
  // plain shell — so the session is mirrored with Warp/tmux on the PC.
  tmux?: string;
  // Command to run if the tmux session is newly created (e.g. 'claude').
  launch?: string;
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
  agentId?: string;
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

export interface ClaudeHookPayload {
  agentId?: string;
  event: string; // 'stop' | 'idle_prompt' | 'permission_request' | 'prompt_submit' | 'tool_complete'
  query?: string;
  response?: string;
  summary?: string;
  tool_name?: string;
  // Where the turn happened, so a notification can deep-link to the transcript.
  projectPath?: string;
  claudeSessionId?: string;
}

export interface ClaudeNotifyPayload {
  agentId?: string;
  event: string;
  title: string;
  body: string;
}

// --- Shared tmux session payloads ---

export interface TmuxSessionInfo {
  name: string;
  windows: number;
  attached: boolean;
  activity?: number; // last-activity unix seconds
  path?: string; // cwd of the session (Claude's cwd if one runs inside, else the active pane's)
  claudeTitle?: string; // live Claude Code chat name (auto-generated or /rename'd)
  claudeStatus?: string; // live Claude Code status, e.g. 'busy' | 'idle'
}

export interface TmuxListPayload {
  agentId?: string;
  requestId?: string;
}

export interface TmuxListResultPayload {
  requestId?: string;
  agentId?: string;
  sessions: TmuxSessionInfo[];
  error?: string;
}

export interface TmuxKillPayload {
  agentId?: string;
  name: string;
  requestId?: string;
}

export interface TmuxKillResultPayload {
  requestId?: string;
  agentId?: string;
  name: string;
  ok: boolean;
  error?: string;
}

// --- File Explorer Payloads ---

export interface FilesListPayload {
  agentId?: string;
  requestId?: string;
  path: string;
}

export interface FilesListResultPayload {
  requestId: string;
  agentId?: string;
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
  agentId?: string;
  fileId: string;
  fileName: string;
  downloadUrl: string;
  size: number;
}

export interface FilesDownloadErrorPayload {
  requestId: string;
  agentId?: string;
  path?: string;
  error: string;
}
