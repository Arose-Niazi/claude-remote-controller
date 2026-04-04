import { create } from 'zustand';
import type { AgentInfo } from '@crc/shared';

interface AgentState {
  agents: AgentInfo[];
  setAgents: (agents: AgentInfo[]) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  setAgents: (agents: AgentInfo[]) => set({ agents }),
}));
