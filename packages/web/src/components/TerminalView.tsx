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
import ChatView, { type ChatMessage } from './ChatView';

interface TerminalViewProps {
  socket: Socket | null;
}

let downloadCounter = 0;
let msgCounter = 0;

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
  const [rawMode, setRawMode] = useState(false);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [composeText, setComposeText] = useState('');
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const ctrlRef = useRef(false);
  const altRef = useRef(false);

  // Chat message tracking
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const outputBufferRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushOutputBuffer = useCallback(() => {
    const text = outputBufferRef.current;
    if (text.trim()) {
      setChatMessages((prev) => [
        ...prev,
        { id: ++msgCounter, type: 'received', text, timestamp: Date.now() },
      ]);
    }
    outputBufferRef.current = '';
  }, []);

  const appendOutput = useCallback(
    (data: string) => {
      outputBufferRef.current += data;
      // Debounce: flush after 400ms of no new data
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(flushOutputBuffer, 400);
    },
    [flushOutputBuffer]
  );

  const addSentMessage = useCallback((text: string) => {
    // Flush any pending output before adding sent message
    if (outputBufferRef.current.trim()) {
      setChatMessages((prev) => [
        ...prev,
        { id: ++msgCounter, type: 'received', text: outputBufferRef.current, timestamp: Date.now() },
      ]);
      outputBufferRef.current = '';
    }
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    setChatMessages((prev) => [
      ...prev,
      { id: ++msgCounter, type: 'sent', text, timestamp: Date.now() },
    ]);
  }, []);

  const [downloads, setDownloads] = useState<
    { id: number; fileName: string; downloadUrl: string; size: number }[]
  >([]);
  const token = useAuthStore((s) => s.token);
  const agents = useAgentStore((s) => s.agents);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agent = agents.find((a) => a.id === agentId);
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
      appendOutput('\x1b[33m[Session ended]\x1b[0m');
    },
    onBuffer: (data) => {
      termRef.current?.write(data);
      appendOutput(data);
    },
    onDetached: (reason) => {
      termRef.current?.write(`\r\n\x1b[33m[Detached: ${reason}]\x1b[0m\r\n`);
      setTimeout(() => navigate(`/sessions/${agentId}`), 1500);
    },
  });

  // Keep refs in sync
  useEffect(() => { ctrlRef.current = ctrlActive; }, [ctrlActive]);
  useEffect(() => { altRef.current = altActive; }, [altActive]);

  const toggleCtrl = useCallback(() => setCtrlActive((p) => !p), []);
  const toggleAlt = useCallback(() => setAltActive((p) => !p), []);

  // Initialize xterm.js
  useEffect(() => {
    if (!termContainerRef.current) return;

    const isMobile = window.innerWidth < 768;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: isMobile ? 11 : 14,
      fontFamily: 'Menlo, Monaco, "Cascadia Code", monospace',
      disableStdin: false,
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

  // Toggle xterm keyboard capture based on rawMode
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (rawMode) {
      term.options.disableStdin = false;
      term.focus();
    } else {
      term.options.disableStdin = true;
      (term as any).textarea?.blur();
    }
  }, [rawMode]);

  // Wire up terminal output — feeds both xterm AND chat view
  useEffect(() => {
    if (!socket || !termRef.current) return;

    const handleOutput = (payload: { sessionId: string; data: string }) => {
      if (payload.sessionId === sessionId) {
        termRef.current?.write(payload.data);
        appendOutput(payload.data);
      }
    };

    socket.on(TERMINAL_OUTPUT, handleOutput);
    return () => {
      socket.off(TERMINAL_OUTPUT, handleOutput);
    };
  }, [socket, sessionId, appendOutput]);

  // Auto-write initial command from ?cmd= param
  useEffect(() => {
    if (!initialCmd || !sessionId || cmdSentRef.current) return;
    cmdSentRef.current = true;
    const timer = setTimeout(() => {
      write(initialCmd + '\r');
      addSentMessage(initialCmd);
    }, 500);
    return () => clearTimeout(timer);
  }, [initialCmd, sessionId, write, addSentMessage]);

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
      if (rawMode) termRef.current?.focus();
    },
    [write, rawMode]
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
        const cmd = `curl -o "${result.fileName}" "${origin}${result.downloadUrl}"`;
        write(cmd + '\r');
        addSentMessage(cmd);
      }
    } catch {
      termRef.current?.write('\r\n\x1b[31m[Upload failed]\x1b[0m\r\n');
    } finally {
      setUploading(false);
      input.value = '';
    }
  }, [token, write, addSentMessage]);

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

  const handleComposeSend = useCallback(() => {
    if (!composeText) return;
    addSentMessage(composeText);
    write(composeText + '\r');
    setComposeText('');
    composeRef.current?.focus();
  }, [composeText, write, addSentMessage]);

  const handleComposeRaw = useCallback(() => {
    if (!composeText) return;
    addSentMessage(composeText);
    write(composeText);
    setComposeText('');
    composeRef.current?.focus();
  }, [composeText, write, addSentMessage]);

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
      />

      {/* Toolbar */}
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
            onClick={() => setRawMode((p) => !p)}
            className={`px-2 py-1 text-xs rounded-lg transition-colors whitespace-nowrap ${
              rawMode
                ? 'bg-accent text-white'
                : 'bg-surface-raised hover:bg-surface-overlay border border-border-subtle text-text-secondary'
            }`}
            title="Toggle raw terminal mode (direct keyboard input)"
          >
            TTY
          </button>
          <button
            onClick={handleKill}
            className="px-2 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors whitespace-nowrap"
          >
            Kill
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden relative">
        {/* xterm.js — always mounted, visible only in TTY mode */}
        <div
          ref={termContainerRef}
          className={`absolute inset-0 pl-2 ${rawMode ? '' : 'invisible'}`}
        />

        {/* Chat view — visible in compose mode */}
        {!rawMode && (
          <div className="absolute inset-0 flex flex-col bg-surface-deep">
            <ChatView messages={chatMessages} />
          </div>
        )}

        {/* File explorer overlay */}
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

      {/* Compose input — chat-style primary input (compose mode) */}
      {!rawMode && (
        <div className="px-2 py-2 bg-surface border-t border-border flex-shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={composeRef}
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleComposeSend();
                }
              }}
              placeholder="Type a command..."
              rows={composeText.includes('\n') ? Math.min(composeText.split('\n').length, 5) : 1}
              className="flex-1 px-4 py-2.5 text-sm bg-surface-deep border border-border rounded-2xl text-text placeholder:text-text-muted focus:outline-none focus:border-accent resize-none leading-relaxed"
              autoFocus
            />
            <button
              onClick={handleComposeSend}
              disabled={!composeText}
              className="p-2.5 bg-accent hover:bg-accent-hover text-white rounded-2xl transition-colors disabled:opacity-30 flex-shrink-0"
              title="Send (Enter)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2 mt-1.5 px-1">
            <button
              onClick={handleComposeRaw}
              disabled={!composeText}
              className="text-[10px] text-text-muted hover:text-text-secondary disabled:opacity-30 transition-colors"
            >
              Send raw (no enter)
            </button>
            <span className="text-[10px] text-text-muted/50">|</span>
            <span className="text-[10px] text-text-muted/50">Shift+Enter for newline</span>
          </div>
        </div>
      )}

      {/* Mobile extra keys — always visible */}
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
