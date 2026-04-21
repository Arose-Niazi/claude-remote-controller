import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { AGENTS_UPDATE, SESSIONS_UPDATE, TERMINAL_EXIT } from '@crc/shared';
import type { AgentInfo, TerminalSession, TerminalExitPayload } from '@crc/shared';
import { getSocket, disconnectSocket } from '../api/socket';
import { useAuthStore } from '../stores/authStore';
import { useAgentStore } from '../stores/agentStore';
import { useSessionStore } from '../stores/sessionStore';
import { useNotificationStore } from '../stores/notificationStore';
import { showBrowserNotification, playSound, flashTitle } from '../lib/notify';

export function useSocket(): { socket: Socket | null; connected: boolean } {
  const token = useAuthStore((s) => s.token);
  const setAgents = useAgentStore((s) => s.setAgents);
  const setSessions = useSessionStore((s) => s.setSessions);
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
    socket.on(SESSIONS_UPDATE, (sessions: TerminalSession[]) => setSessions(sessions));

    // Global listener: fire notifications when any session exits
    socket.on(TERMINAL_EXIT, (payload: TerminalExitPayload) => {
      const { enabled, addToast } = useNotificationStore.getState();
      if (!enabled) return;

      const name = payload.sessionName || 'Session';
      const title = 'Session ended';
      const body = `"${name}" exited (code ${payload.exitCode})`;
      addToast(title, body);
      showBrowserNotification(title, body);
      playSound();
      flashTitle('Session ended!');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off(AGENTS_UPDATE);
      socket.off(SESSIONS_UPDATE);
      socket.off(TERMINAL_EXIT);
    };
  }, [token, setAgents, setSessions]);

  return { socket: socketRef.current, connected };
}
