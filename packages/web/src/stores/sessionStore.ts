import { create } from 'zustand';
import type { TerminalSession } from '@crc/shared';

interface SessionState {
  sessions: TerminalSession[];
  setSessions: (sessions: TerminalSession[]) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  setSessions: (sessions: TerminalSession[]) => set({ sessions }),
}));
