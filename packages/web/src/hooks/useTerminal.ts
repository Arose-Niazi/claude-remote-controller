import { useEffect, useRef, useCallback, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  TERMINAL_OPEN,
  TERMINAL_INPUT,
  TERMINAL_RESIZE,
  TERMINAL_CLOSE,
  TERMINAL_READY,
  TERMINAL_OUTPUT,
  TERMINAL_EXIT,
} from '@crc/shared';

interface UseTerminalOptions {
  socket: Socket | null;
  agentId: string;
  onReady?: (sessionId: string) => void;
  onExit?: (exitCode: number) => void;
}

export function useTerminal({ socket, agentId, onReady, onExit }: UseTerminalOptions) {
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const open = useCallback(
    (cols: number, rows: number) => {
      if (!socket) return;
      socket.emit(TERMINAL_OPEN, { agentId, cols, rows });
    },
    [socket, agentId]
  );

  const write = useCallback(
    (data: string) => {
      if (!socket || !sessionIdRef.current) return;
      socket.emit(TERMINAL_INPUT, { sessionId: sessionIdRef.current, data });
    },
    [socket]
  );

  const resize = useCallback(
    (cols: number, rows: number) => {
      if (!socket || !sessionIdRef.current) return;
      socket.emit(TERMINAL_RESIZE, { sessionId: sessionIdRef.current, cols, rows });
    },
    [socket]
  );

  const close = useCallback(() => {
    if (!socket || !sessionIdRef.current) return;
    socket.emit(TERMINAL_CLOSE, { sessionId: sessionIdRef.current });
    sessionIdRef.current = null;
    setSessionId(null);
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleReady = (payload: { sessionId: string }) => {
      sessionIdRef.current = payload.sessionId;
      setSessionId(payload.sessionId);
      onReady?.(payload.sessionId);
    };

    const handleExit = (payload: { sessionId: string; exitCode: number }) => {
      if (payload.sessionId === sessionIdRef.current) {
        sessionIdRef.current = null;
        setSessionId(null);
        onExit?.(payload.exitCode);
      }
    };

    socket.on(TERMINAL_READY, handleReady);
    socket.on(TERMINAL_EXIT, handleExit);

    return () => {
      socket.off(TERMINAL_READY, handleReady);
      socket.off(TERMINAL_EXIT, handleExit);
    };
  }, [socket, onReady, onExit]);

  return { sessionId, open, write, resize, close };
}
