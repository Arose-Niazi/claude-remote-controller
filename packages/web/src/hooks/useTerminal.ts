import { useEffect, useRef, useCallback, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  SESSION_CREATE,
  SESSION_ATTACH,
  SESSION_DETACH,
  SESSION_KILL,
  TERMINAL_INPUT,
  TERMINAL_RESIZE,
  TERMINAL_READY,
  TERMINAL_EXIT,
  SESSION_BUFFER,
  SESSION_DETACHED,
} from '@crc/shared';

interface UseTerminalOptions {
  socket: Socket | null;
  agentId: string;
  existingSessionId?: string;
  onReady?: (sessionId: string) => void;
  onExit?: (exitCode: number) => void;
  onBuffer?: (data: string) => void;
  onDetached?: (reason: string) => void;
}

export function useTerminal({
  socket,
  agentId,
  existingSessionId,
  onReady,
  onExit,
  onBuffer,
  onDetached,
}: UseTerminalOptions) {
  const sessionIdRef = useRef<string | null>(existingSessionId || null);
  const [sessionId, setSessionId] = useState<string | null>(existingSessionId || null);

  // Keep the latest callbacks in refs so the socket listener effect can depend
  // only on [socket] instead of churning off()/on() on every render when the
  // caller passes inline (re-created) callbacks.
  const onReadyRef = useRef(onReady);
  const onExitRef = useRef(onExit);
  const onBufferRef = useRef(onBuffer);
  const onDetachedRef = useRef(onDetached);
  useEffect(() => {
    onReadyRef.current = onReady;
    onExitRef.current = onExit;
    onBufferRef.current = onBuffer;
    onDetachedRef.current = onDetached;
  }, [onReady, onExit, onBuffer, onDetached]);

  const create = useCallback(
    (cols: number, rows: number, name?: string, opts?: { tmux?: string; launch?: string }) => {
      if (!socket) return;
      socket.emit(SESSION_CREATE, {
        agentId,
        name,
        cols,
        rows,
        tmux: opts?.tmux,
        launch: opts?.launch,
      });
    },
    [socket, agentId]
  );

  const attach = useCallback(
    (sid: string, cols: number, rows: number) => {
      if (!socket) return;
      sessionIdRef.current = sid;
      setSessionId(sid);
      socket.emit(SESSION_ATTACH, { sessionId: sid, cols, rows });
    },
    [socket]
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

  const detach = useCallback(() => {
    if (!socket || !sessionIdRef.current) return;
    socket.emit(SESSION_DETACH, { sessionId: sessionIdRef.current });
    sessionIdRef.current = null;
    setSessionId(null);
  }, [socket]);

  const kill = useCallback(() => {
    if (!socket || !sessionIdRef.current) return;
    socket.emit(SESSION_KILL, { sessionId: sessionIdRef.current });
    sessionIdRef.current = null;
    setSessionId(null);
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleReady = (payload: { sessionId: string }) => {
      sessionIdRef.current = payload.sessionId;
      setSessionId(payload.sessionId);
      onReadyRef.current?.(payload.sessionId);
    };

    const handleExit = (payload: { sessionId: string; exitCode: number }) => {
      if (payload.sessionId === sessionIdRef.current) {
        sessionIdRef.current = null;
        setSessionId(null);
        onExitRef.current?.(payload.exitCode);
      }
    };

    const handleBuffer = (payload: { sessionId: string; data: string }) => {
      if (payload.sessionId === sessionIdRef.current) {
        onBufferRef.current?.(payload.data);
      }
    };

    const handleDetached = (payload: { sessionId: string; reason: string }) => {
      if (payload.sessionId === sessionIdRef.current || payload.sessionId === '') {
        sessionIdRef.current = null;
        setSessionId(null);
        onDetachedRef.current?.(payload.reason);
      }
    };

    socket.on(TERMINAL_READY, handleReady);
    socket.on(TERMINAL_EXIT, handleExit);
    socket.on(SESSION_BUFFER, handleBuffer);
    socket.on(SESSION_DETACHED, handleDetached);

    return () => {
      socket.off(TERMINAL_READY, handleReady);
      socket.off(TERMINAL_EXIT, handleExit);
      socket.off(SESSION_BUFFER, handleBuffer);
      socket.off(SESSION_DETACHED, handleDetached);
    };
  }, [socket]);

  return { sessionId, create, attach, write, resize, detach, kill };
}
