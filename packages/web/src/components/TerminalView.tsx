import { useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { TERMINAL_OUTPUT, TERMINAL_EXIT } from '@crc/shared';
import { useTerminal } from '../hooks/useTerminal';
import MobileKeyboard from './MobileKeyboard';

interface TerminalViewProps {
  socket: Socket | null;
}

export default function TerminalView({ socket }: TerminalViewProps) {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const { sessionId, open, write, resize, close } = useTerminal({
    socket,
    agentId: agentId || '',
    onExit: () => {
      termRef.current?.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
    },
  });

  // Initialize xterm.js
  useEffect(() => {
    if (!termContainerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Cascadia Code", monospace',
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        selectionBackground: '#334155',
        black: '#1e293b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#f8fafc',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(termContainerRef.current);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to canvas
    }

    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle user input
    term.onData((data) => {
      write(data);
    });

    // Open terminal session on server
    open(term.cols, term.rows);

    // Handle resize
    const onResize = () => {
      fitAddon.fit();
      resize(term.cols, term.rows);
    };
    window.addEventListener('resize', onResize);

    // Also handle orientation change on mobile
    window.addEventListener('orientationchange', () => {
      setTimeout(onResize, 100);
    });

    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire up terminal output from socket
  useEffect(() => {
    if (!socket || !termRef.current) return;

    const handleOutput = (payload: { sessionId: string; data: string }) => {
      if (payload.sessionId === sessionId) {
        termRef.current?.write(payload.data);
      }
    };

    socket.on(TERMINAL_OUTPUT, handleOutput);
    return () => {
      socket.off(TERMINAL_OUTPUT, handleOutput);
    };
  }, [socket, sessionId]);

  const handleDisconnect = useCallback(() => {
    close();
    navigate('/dashboard');
  }, [close, navigate]);

  const handleMobileKey = useCallback(
    (data: string) => {
      write(data);
      termRef.current?.focus();
    },
    [write]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
        <button
          onClick={handleDisconnect}
          className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          ← Back
        </button>
        <span className="text-sm text-slate-300 font-medium">{agentId}</span>
        <div className="flex gap-2">
          <button
            disabled
            title="Upload (Phase 4)"
            className="px-3 py-1 text-sm bg-slate-700 text-slate-500 rounded cursor-not-allowed"
          >
            Upload
          </button>
          <button
            onClick={handleDisconnect}
            className="px-3 py-1 text-sm bg-red-900/60 hover:bg-red-800 text-red-300 rounded transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div ref={termContainerRef} className="flex-1 overflow-hidden" />

      {/* Mobile extra keys */}
      <MobileKeyboard onKey={handleMobileKey} />
    </div>
  );
}
