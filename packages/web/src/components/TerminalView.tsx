import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { TERMINAL_OUTPUT } from '@crc/shared';
import { useTerminal } from '../hooks/useTerminal';
import { useAuthStore } from '../stores/authStore';
import { useAgentStore } from '../stores/agentStore';
import MobileKeyboard from './MobileKeyboard';
import FileExplorer from './FileExplorer';
import FileNotifications from './FileNotifications';

interface TerminalViewProps {
  socket: Socket | null;
}

let downloadCounter = 0;

export default function TerminalView({ socket }: TerminalViewProps) {
  const { agentId, sessionId: paramSessionId } = useParams<{
    agentId: string;
    sessionId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialCmd = searchParams.get('cmd');
  const cmdSentRef = useRef(false);
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isNewSession = paramSessionId === 'new';
  const [uploading, setUploading] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [showFiles, setShowFiles] = useState(false);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [composeText, setComposeText] = useState('');
  const composeRef = useRef<HTMLInputElement>(null);
  const ctrlRef = useRef(false);
  const altRef = useRef(false);
  const [downloads, setDownloads] = useState<
    { id: number; fileName: string; downloadUrl: string; size: number }[]
  >([]);
  const token = useAuthStore((s) => s.token);
  const agents = useAgentStore((s) => s.agents);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agent = agents.find((a) => a.id === agentId);
  // Use agent's homeDirectory from heartbeat (which already respects homeDir config)
  // Fall back to root paths or / if heartbeat hasn't arrived yet
  const initialPath = agent?.homeDirectory || agent?.rootPaths?.[0] || '/';

  const {
    sessionId,
    create,
    attach,
    write,
    resize,
    detach,
    kill,
  } = useTerminal({
    socket,
    agentId: agentId || '',
    existingSessionId: isNewSession ? undefined : paramSessionId,
    onExit: () => {
      termRef.current?.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n');
    },
    onBuffer: (data) => {
      termRef.current?.write(data);
    },
    onDetached: (reason) => {
      termRef.current?.write(`\r\n\x1b[33m[Detached: ${reason}]\x1b[0m\r\n`);
      setTimeout(() => navigate(`/sessions/${agentId}`), 1500);
    },
  });

  // Keep refs in sync (onData callback captures stale closures)
  useEffect(() => { ctrlRef.current = ctrlActive; }, [ctrlActive]);
  useEffect(() => { altRef.current = altActive; }, [altActive]);

  const toggleCtrl = useCallback(() => setCtrlActive((p) => !p), []);
  const toggleAlt = useCallback(() => setAltActive((p) => !p), []);

  // Initialize xterm.js
  useEffect(() => {
    if (!termContainerRef.current) return;

    // Smaller font on mobile to get ~80 columns on a phone screen
    const isMobile = window.innerWidth < 768;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: isMobile ? 11 : 14,
      fontFamily: 'Menlo, Monaco, "Cascadia Code", monospace',
      theme: {
        background: '#1a1a1e',
        foreground: '#e8e4e0',
        cursor: '#d4714e',
        selectionBackground: '#3a3a42',
        black: '#232328',
        red: '#d9534f',
        green: '#5cb85c',
        yellow: '#d4a04e',
        blue: '#5b9bd5',
        magenta: '#9b7ddb',
        cyan: '#5bc0de',
        white: '#e8e4e0',
        brightBlack: '#4a4a52',
        brightRed: '#e06b67',
        brightGreen: '#72c872',
        brightYellow: '#e0b464',
        brightBlue: '#74b0e0',
        brightMagenta: '#af92e3',
        brightCyan: '#74d0e8',
        brightWhite: '#f2eeea',
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
      // WebGL not available
    }

    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      let out = data;
      if (ctrlRef.current && out.length === 1) {
        const code = out.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) {
          out = String.fromCharCode(code - 96);
          setCtrlActive(false);
        }
      }
      if (altRef.current) {
        out = '\x1b' + out;
        setAltActive(false);
      }
      write(out);
    });

    if (isNewSession) {
      create(term.cols, term.rows);
    } else if (paramSessionId) {
      attach(paramSessionId, term.cols, term.rows);
    }

    const onResize = () => {
      fitAddon.fit();
      resize(term.cols, term.rows);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 100));

    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire up terminal output
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

  // Auto-write initial command from ?cmd= param (e.g., Claude resume)
  useEffect(() => {
    if (!initialCmd || !sessionId || cmdSentRef.current) return;
    cmdSentRef.current = true;
    // Wait for shell prompt to appear
    const timer = setTimeout(() => {
      write(initialCmd + '\n');
    }, 500);
    return () => clearTimeout(timer);
  }, [initialCmd, sessionId, write]);

  const handleDetach = useCallback(() => {
    detach();
    navigate(`/sessions/${agentId}`);
  }, [detach, navigate, agentId]);

  const handleKill = useCallback(() => {
    kill();
    navigate(`/sessions/${agentId}`);
  }, [kill, navigate, agentId]);

  const handleMobileKey = useCallback(
    (data: string) => {
      write(data);
      termRef.current?.focus();
    },
    [write]
  );

  const handleCopy = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    const selection = term.getSelection();
    const text = selection || term.buffer.active.getLine(term.buffer.active.cursorY)?.translateToString() || '';
    navigator.clipboard.writeText(text);
    setCopyLabel('Copied!');
    setTimeout(() => setCopyLabel('Copy'), 1500);
  }, []);

  const handleUpload = useCallback(async () => {
    const input = fileInputRef.current;
    if (!input?.files?.[0]) return;
    const file = input.files[0];
    setUploading(true);
    try {
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-File-Name': file.name,
        },
        body: file,
      });
      const result = await res.json();
      if (result.downloadUrl) {
        const origin = window.location.origin;
        const cmd = `curl -o "${result.fileName}" "${origin}${result.downloadUrl}"\n`;
        write(cmd);
      }
    } catch {
      termRef.current?.write('\r\n\x1b[31m[Upload failed]\x1b[0m\r\n');
    } finally {
      setUploading(false);
      input.value = '';
    }
  }, [token, write]);

  const handleDownloadReady = useCallback(
    (info: { fileName: string; downloadUrl: string; size: number }) => {
      setDownloads((prev) => [
        ...prev,
        { id: ++downloadCounter, ...info },
      ]);
    },
    []
  );

  const dismissDownload = useCallback((id: number) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
      />

      {/* Toolbar -- single line, scrollable on small screens */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-surface border-b border-border overflow-x-auto flex-shrink-0">
        <button
          onClick={handleDetach}
          className="px-2 py-1 text-xs bg-surface-raised hover:bg-surface-overlay border border-border-subtle text-text-secondary rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
        >
          ←
        </button>
        <span className="text-xs text-text-muted truncate min-w-0">{agentId}</span>
        <div className="flex gap-1 ml-auto flex-shrink-0">
          <button
            onClick={handleCopy}
            className="px-2 py-1 text-xs bg-surface-raised hover:bg-surface-overlay border border-border-subtle text-text-secondary rounded-lg transition-colors whitespace-nowrap"
          >
            {copyLabel}
          </button>
          <button
            onClick={() => setShowFiles((p) => !p)}
            className={`px-2 py-1 text-xs rounded-lg transition-colors whitespace-nowrap ${
              showFiles
                ? 'bg-claude text-white'
                : 'bg-surface-raised hover:bg-surface-overlay border border-border-subtle text-text-secondary'
            }`}
          >
            Files
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-2 py-1 text-xs bg-surface-raised hover:bg-surface-overlay border border-border-subtle text-text-secondary rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            {uploading ? '...' : 'Up'}
          </button>
          <button
            onClick={handleKill}
            className="px-2 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors whitespace-nowrap"
          >
            Kill
          </button>
        </div>
      </div>

      {/* Main area: terminal (always full width) */}
      <div className="flex-1 overflow-hidden relative">
        <div ref={termContainerRef} className="absolute inset-0 pl-2" />

        {/* File explorer: full-screen overlay on mobile, side panel on desktop */}
        {showFiles && (
          <div className="absolute inset-0 md:left-auto md:w-80 z-10">
            <FileExplorer
              socket={socket}
              agentId={agentId || ''}
              initialPath={initialPath}
              onClose={() => setShowFiles(false)}
              onDownloadReady={handleDownloadReady}
            />
          </div>
        )}
      </div>

      {/* Download notifications */}
      <FileNotifications downloads={downloads} onDismiss={dismissDownload} />

      {/* Compose input — type/paste text locally, send on Enter */}
      <div className="flex items-center gap-1 px-2 py-1 bg-surface border-t border-border flex-shrink-0">
        <input
          ref={composeRef}
          type="text"
          value={composeText}
          onChange={(e) => setComposeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && composeText) {
              write(composeText + '\n');
              setComposeText('');
            }
          }}
          placeholder="Type or paste text..."
          className="flex-1 px-3 py-1.5 text-xs bg-surface-deep border border-border rounded-lg text-text placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <button
          onClick={() => {
            if (composeText) {
              write(composeText + '\n');
              setComposeText('');
              composeRef.current?.focus();
            }
          }}
          disabled={!composeText}
          className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors disabled:opacity-30 flex-shrink-0"
        >
          Send
        </button>
        <button
          onClick={() => {
            if (composeText) {
              write(composeText);
              setComposeText('');
              composeRef.current?.focus();
            }
          }}
          disabled={!composeText}
          className="px-2 py-1.5 text-xs bg-surface-raised hover:bg-surface-overlay border border-border-subtle text-text-secondary rounded-lg transition-colors disabled:opacity-30 flex-shrink-0"
          title="Send without Enter (raw paste)"
        >
          Raw
        </button>
      </div>

      {/* Mobile extra keys */}
      <MobileKeyboard
        onKey={handleMobileKey}
        ctrlActive={ctrlActive}
        altActive={altActive}
        onToggleCtrl={toggleCtrl}
        onToggleAlt={toggleAlt}
      />
    </div>
  );
}
