import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { AGENTS_UPDATE } from '@crc/shared';
import type { AgentInfo } from '@crc/shared';
import { getSocket, disconnectSocket } from '../api/socket';
import { useAuthStore } from '../stores/authStore';
import { useAgentStore } from '../stores/agentStore';

export function useSocket(): { socket: Socket | null; connected: boolean } {
  const token = useAuthStore((s) => s.token);
  const setAgents = useAgentStore((s) => s.setAgents);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) {
      disconnectSocket();
      socketRef.current = null;
      setConnected(false);
      return;
    }

    const socket = getSocket(token);
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on(AGENTS_UPDATE, (agents: AgentInfo[]) => setAgents(agents));

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off(AGENTS_UPDATE);
    };
  }, [token, setAgents]);

  return { socket: socketRef.current, connected };
}
