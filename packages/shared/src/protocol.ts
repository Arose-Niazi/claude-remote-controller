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
// Also uses TERMINAL_OUTPUT and TERMINAL_EXIT

// --- File Events (defined now, handlers implemented Phase 4) ---
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

export interface FileGrabPayload {
  agentId: string;
  remotePath: string;
}
