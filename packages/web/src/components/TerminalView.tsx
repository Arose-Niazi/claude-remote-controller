import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import {
  TERMINAL_OUTPUT,
  CLAUDE_CONV_READ,
  CLAUDE_CONV_DATA,
  FILES_DOWNLOAD,
  FILES_DOWNLOAD_READY,
  FILES_DOWNLOAD_ERROR,
} from '@crc/shared';
import { useNotificationStore } from '../stores/notificationStore';
import { showBrowserNotification, playSound, flashTitle } from '../lib/notify';
import type {
  ClaudeConvMessage,
  ClaudeConvDataPayload,
  FilesDownloadReadyPayload,
  FilesDownloadErrorPayload,
} from '@crc/shared';
import { useTerminal } from '../hooks/useTerminal';
import { useAuthStore } from '../stores/authStore';
import { useAgentStore } from '../stores/agentStore';
import MobileKeyboard from './MobileKeyboard';
import FileExplorer from './FileExplorer';
import FileNotifications from './FileNotifications';
import ChatView from './ChatView';
import {
  detectClaudePrompt,
  promptsEqual,
  buildPromptSelectionKeys,
  type DetectedPrompt,
} from '../lib/detectPrompt';
import { resolveFilePath } from '../lib/parseFilePaths';

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
  // Ensures the session bootstrap (create/attach) runs exactly once, even
  // though its effect depends on `socket` and may re-run when socket changes.
  const didBootstrapRef = useRef(false);
  const isNewSession = paramSessionId === 'new';
  const [uploading, setUploading] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [showFiles, setShowFiles] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [pendingSent, setPendingSent] = useState<string[]>([]);
  const composeRef = useRef<HTMLTextAreaElement>(null);

  // Conversation polling from JSONL
  const [convMessages, setConvMessages] = useState<ClaudeConvMessage[]>([]);
  const convLineRef = useRef(0);
  const convProjectRef = useRef<string | null>(null);
  const convClaudeSessionRef = useRef<string | null>(null);
  // Live mirror of the terminal sessionId (null for a brand-new session until
  // the server assigns one). Read this inside long-lived listeners so we don't
  // capture a stale null from when the effect was first set up.
  const sessionIdRef = useRef<string | null>(null);
  const ctrlRef = useRef(false);
  const altRef = useRef(false);
  const [downloads, setDownloads] = useState<
    { id: number; fileName: string; downloadUrl: string; size: number }[]
  >([]);
  // requestIds of FILES_DOWNLOAD requests this view has emitted, so result/error
  // events can be correlated back to us (secondary guard alongside agentId).
  const downloadRequestIdsRef = useRef<Set<string>>(new Set());
  const token = useAuthStore((s) => s.token);
  const agents = useAgentStore((s) => s.agents);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live Claude Code prompt detection from the xterm buffer
  const [terminalPrompt, setTerminalPrompt] = useState<DetectedPrompt | null>(null);
  const terminalPromptRef = useRef<DetectedPrompt | null>(null);
  const promptCheckTimerRef = useRef<number | null>(null);
  const [ttyScrolledUp, setTtyScrolledUp] = useState(false);

  // Claude task completion detection
  // Tracks: idle → user_sent → claude_active → (finished notification) → idle
  const claudeTurnRef = useRef<'idle' | 'user_sent' | 'claude_active'>('idle');
  const claudeNotifiedRef = useRef(false);
  const lastConvMsgTimeRef = useRef(0);
  const lastTermOutputTimeRef = useRef(0);
  // Per-category cooldown: a category may not re-fire within 10s, but distinct
  // categories (prompt / bell / osc-stop / osc-permission / conv-idle / osc-plain)
  // never block each other.
  const NOTIFY_COOLDOWN = 10_000;
  const lastNotifyByCategoryRef = useRef<Map<string, number>>(new Map());
  // Returns true when this category is allowed to notify (and records the time).
  const canNotify = useCallback((category: string, now = Date.now()) => {
    const last = lastNotifyByCategoryRef.current.get(category) || 0;
    if (now - last < NOTIFY_COOLDOWN) return false;
    lastNotifyByCategoryRef.current.set(category, now);
    return true;
  }, []);

  const agent = agents.find((a) => a.id === agentId);
  const initialPath = agent?.homeDirectory || agent?.rootPaths?.[0] || '/';

  const schedulePromptCheck = useCallback(() => {
    if (promptCheckTimerRef.current !== null) return;
    promptCheckTimerRef.current = window.setTimeout(() => {
      promptCheckTimerRef.current = null;
      const term = termRef.current;
      if (!term) return;
      const detected = detectClaudePrompt(term);
      if (!promptsEqual(detected, terminalPromptRef.current)) {
        terminalPromptRef.current = detected;
        setTerminalPrompt(detected);
      }
      // Keep the scrolled-up indicator fresh on new output too
      const buf = term.buffer.active;
      setTtyScrolledUp(buf.viewportY < buf.baseY);
    }, 80);
  }, []);

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
      termRef.current?.write(data, () => schedulePromptCheck());
    },
    onDetached: (reason) => {
      termRef.current?.write(`\r\n\x1b[33m[Detached: ${reason}]\x1b[0m\r\n`);
      setTimeout(() => navigate(`/sessions/${agentId}`), 1500);
    },
  });

  // Notify when Claude shows a prompt (permission/selection question).
  // Fires even in raw/no-conversation mode where claudeTurn stays 'idle' — a
  // freshly detected prompt is enough on its own, subject to the per-category
  // cooldown so we don't spam on every redraw.
  useEffect(() => {
    if (!terminalPrompt) return;
    const { enabled, addToast } = useNotificationStore.getState();
    if (!enabled) return;
    if (!canNotify('prompt')) return;
    const title = 'Claude needs input';
    const body = terminalPrompt.question || 'Waiting for your response';
    addToast(title, body);
    showBrowserNotification(title, body);
    playSound();
    flashTitle('Claude needs input');
  }, [terminalPrompt, canNotify]);

  // Clear stale pending messages after 30 seconds
  useEffect(() => {
    if (pendingSent.length === 0) return;
    const timer = setTimeout(() => setPendingSent([]), 30000);
    return () => clearTimeout(timer);
  }, [pendingSent]);

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

    // NOTE: session bootstrap (create/attach) happens in a separate effect that
    // waits for `socket` to be available — see below. Doing it here would fire
    // before the socket connects on a fresh load/refresh, and never retry.

    const onResize = () => {
      fitAddon.fit();
      resize(term.cols, term.rows);
    };
    const onOrientationChange = () => setTimeout(onResize, 100);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientationChange);

    const scrollDisposable = term.onScroll(() => {
      const buf = term.buffer.active;
      setTtyScrolledUp(buf.viewportY < buf.baseY);
    });

    // Fire notification on terminal bell (BEL character \x07)
    // Lets users do: long_command; echo -e '\a'
    let lastBellTime = 0;
    const bellDisposable = term.onBell(() => {
      const now = Date.now();
      if (now - lastBellTime < 2000) return;
      lastBellTime = now;

      const { enabled, addToast } = useNotificationStore.getState();
      if (!enabled) return;
      if (!canNotify('bell', now)) return;

      const title = 'Terminal Bell';
      const body = 'A command wants your attention';
      addToast(title, body);
      showBrowserNotification(title, body);
      playSound();
      flashTitle('Terminal Bell');
    });

    // Parse OSC 777 notifications from Claude Code hooks.
    // Emitted by CRC plugin (crc://agent) or Warp plugin (warp://cli-agent).
    // Format: \033]777;notify;<prefix>;<JSON>\007
    const oscDisposable = term.parser.registerOscHandler(777, (data) => {
      const parts = data.split(';');
      if (parts[0] !== 'notify' || parts.length < 2) return false;

      const { enabled, addToast } = useNotificationStore.getState();
      const rawTitle = parts[1] || '';
      const rawBody = parts.slice(2).join(';') || '';
      const now = Date.now();

      // Handle structured notifications from CRC or Warp plugins
      if (rawTitle === 'crc://agent' || rawTitle === 'warp://cli-agent') {
        try {
          const payload = JSON.parse(rawBody);
          const event = payload.event as string;

          if (event === 'stop' || event === 'idle_prompt' || event === 'permission_request') {
            // Mark Claude idle regardless of notification cooldown — this state
            // transition must not be lost just because we suppress the toast.
            claudeTurnRef.current = 'idle';
            // Distinct cooldown buckets so a 'stop' doesn't mute a later
            // 'permission_request' (and vice-versa).
            const category = event === 'stop' ? 'osc-stop' : 'osc-permission';
            if (enabled && canNotify(category, now)) {
              // Only record that we've notified when we actually fire, so a
              // suppressed event can still be retried by the conv-idle path.
              claudeNotifiedRef.current = true;
              const title = event === 'stop'
                ? 'Claude finished'
                : event === 'permission_request'
                  ? 'Claude needs permission'
                  : 'Claude needs input';
              const body = event === 'stop'
                ? (payload.query ? `"${payload.query}" — ${payload.response || 'done'}`.slice(0, 200) : 'Task complete')
                : (payload.summary || 'Waiting for your response');
              addToast(title, body);
              showBrowserNotification(title, body);
              playSound();
              flashTitle(title);
            }
          } else if (event === 'prompt_submit') {
            claudeTurnRef.current = 'user_sent';
            claudeNotifiedRef.current = false;
          } else if (event === 'tool_complete') {
            claudeTurnRef.current = 'claude_active';
          }
        } catch {
          // ignore malformed
        }
      } else if (enabled && canNotify('osc-plain', now)) {
        // Plain OSC 777 notification
        addToast(rawTitle, rawBody);
        showBrowserNotification(rawTitle, rawBody);
        playSound();
        flashTitle(rawTitle);
      }

      return true; // handled — suppress from terminal display
    });

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientationChange);
      scrollDisposable.dispose();
      bellDisposable.dispose();
      oscDisposable.dispose();
      if (promptCheckTimerRef.current !== null) {
        window.clearTimeout(promptCheckTimerRef.current);
        promptCheckTimerRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Session bootstrap: create() for a new session or attach() for an existing
  // one. This is deliberately separate from xterm construction and depends on
  // `socket` so it runs once the socket is actually connected — on a fresh
  // page load/refresh the socket is null when the init effect runs, and
  // create/attach early-return without it. A ref guards against double-firing
  // if the socket reference changes.
  useEffect(() => {
    if (didBootstrapRef.current) return;
    if (!socket) return;
    const term = termRef.current;
    if (!term) return;
    didBootstrapRef.current = true;
    if (isNewSession) {
      create(term.cols, term.rows);
    } else if (paramSessionId) {
      attach(paramSessionId, term.cols, term.rows);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

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

  // Refit terminal when switching modes (container visibility changes size)
  useEffect(() => {
    setTimeout(() => {
      fitAddonRef.current?.fit();
      const term = termRef.current;
      if (term) resize(term.cols, term.rows);
    }, 50);
  }, [rawMode, resize]);

  // Detect project path + Claude session ID from ?cmd= param or restore from localStorage
  useEffect(() => {
    if (initialCmd) {
      const pathMatch = initialCmd.match(/cd\s+"?([^";]+)"?\s*;/);
      if (pathMatch) convProjectRef.current = pathMatch[1].replace(/\\\\/g, '\\');
      const resumeMatch = initialCmd.match(/--resume\s+([a-f0-9-]+)/);
      if (resumeMatch) convClaudeSessionRef.current = resumeMatch[1];
    }
  }, [initialCmd]);

  // Mirror the live sessionId into a ref so long-lived listeners (e.g. the
  // conv-data handler, set up before the server assigns an id to a new
  // session) always read the current value instead of a captured null.
  useEffect(() => {
    sessionIdRef.current = sessionId ?? null;
  }, [sessionId]);

  // Once terminal sessionId is known, save or restore conv context
  useEffect(() => {
    if (!sessionId) return;
    const projectKey = `conv-project-${sessionId}`;
    const claudeKey = `conv-claude-session-${sessionId}`;
    if (convProjectRef.current) {
      localStorage.setItem(projectKey, convProjectRef.current);
      if (convClaudeSessionRef.current) {
        localStorage.setItem(claudeKey, convClaudeSessionRef.current);
      }
    } else {
      const savedProject = localStorage.getItem(projectKey);
      if (savedProject) convProjectRef.current = savedProject;
      const savedClaude = localStorage.getItem(claudeKey);
      if (savedClaude) convClaudeSessionRef.current = savedClaude;
    }
  }, [sessionId]);

  // Poll JSONL conversation file every 2 seconds
  useEffect(() => {
    if (!socket || !agentId || rawMode) return;
    const projectPath = convProjectRef.current;
    if (!projectPath) return;

    const handleConvData = (payload: ClaudeConvDataPayload) => {
      if (payload.agentId !== agentId) return;
      // Lock onto the session ID once discovered (for new sessions without --resume).
      // Read the terminal sessionId from the ref so a session that was 'new'
      // when this listener was registered still gets the localStorage write
      // once the server assigns it an id.
      if (payload.sessionId && !convClaudeSessionRef.current) {
        convClaudeSessionRef.current = payload.sessionId;
        const sid = sessionIdRef.current;
        if (sid) localStorage.setItem(`conv-claude-session-${sid}`, payload.sessionId);
      }
      if (payload.messages.length > 0) {
        setConvMessages((prev) => [...prev, ...payload.messages]);
        setPendingSent((prev) => {
          if (prev.length === 0) return prev;
          const newUserMsgs = payload.messages.filter((m) => m.type === 'user');
          if (newUserMsgs.length > 0) return prev.slice(newUserMsgs.length);
          // Assistant responding means prior user input was received
          if (payload.messages.some((m) => m.type === 'assistant')) return [];
          return prev;
        });

        // Claude task completion tracking: new messages arrived
        lastConvMsgTimeRef.current = Date.now();
        const hasClaudeActivity = payload.messages.some(
          (m) => m.type === 'assistant' || m.type === 'tool_use' || m.type === 'tool_result'
        );
        if (hasClaudeActivity) {
          claudeTurnRef.current = 'claude_active';
          claudeNotifiedRef.current = false;
        }
      } else {
        // No new messages — check if Claude has gone idle after being active
        const { enabled, addToast } = useNotificationStore.getState();
        if (
          enabled &&
          claudeTurnRef.current === 'claude_active' &&
          !claudeNotifiedRef.current &&
          !terminalPromptRef.current
        ) {
          const now = Date.now();
          const convIdle = now - lastConvMsgTimeRef.current > 8000;
          const outputIdle = now - lastTermOutputTimeRef.current > 5000;
          if (convIdle && outputIdle && canNotify('conv-idle', now)) {
            claudeNotifiedRef.current = true;
            claudeTurnRef.current = 'idle';
            const title = 'Claude finished';
            const body = 'Task complete — ready for your next prompt';
            addToast(title, body);
            showBrowserNotification(title, body);
            playSound();
            flashTitle('Claude finished!');
          }
        }
      }
      convLineRef.current = payload.totalLines;
    };

    socket.on(CLAUDE_CONV_DATA, handleConvData);

    const claudeSessionId = convClaudeSessionRef.current || undefined;

    // Initial read
    socket.emit(CLAUDE_CONV_READ, { agentId, projectPath, sessionId: claudeSessionId, afterLine: 0 });

    // Poll every 2 seconds
    const interval = setInterval(() => {
      socket.emit(CLAUDE_CONV_READ, {
        agentId,
        projectPath,
        sessionId: convClaudeSessionRef.current || claudeSessionId,
        afterLine: convLineRef.current,
      });
    }, 2000);

    return () => {
      socket.off(CLAUDE_CONV_DATA, handleConvData);
      clearInterval(interval);
    };
  }, [socket, agentId, rawMode]);

  // Wire up terminal output
  useEffect(() => {
    if (!socket || !termRef.current) return;

    const handleOutput = (payload: { sessionId: string; data: string }) => {
      if (payload.sessionId === sessionId) {
        termRef.current?.write(payload.data, () => schedulePromptCheck());
        lastTermOutputTimeRef.current = Date.now();
      }
    };

    socket.on(TERMINAL_OUTPUT, handleOutput);
    return () => {
      socket.off(TERMINAL_OUTPUT, handleOutput);
    };
  }, [socket, sessionId, schedulePromptCheck]);

  // Auto-write initial command from ?cmd= param
  useEffect(() => {
    if (!initialCmd || !sessionId || cmdSentRef.current) return;
    cmdSentRef.current = true;
    const timer = setTimeout(() => {
      write(initialCmd + '\r');
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

  // Listener for downloads THIS view initiated (chat file-link clicks). Matched
  // strictly by our own requestIds so we don't also handle downloads owned by an
  // embedded FileExplorer (which renders its own download cards).
  useEffect(() => {
    if (!socket) return;
    const onReady = (payload: FilesDownloadReadyPayload) => {
      if (!payload.requestId || !downloadRequestIdsRef.current.has(payload.requestId)) return;
      downloadRequestIdsRef.current.delete(payload.requestId);
      handleDownloadReady({
        fileName: payload.fileName,
        downloadUrl: payload.downloadUrl,
        size: payload.size,
      });
    };
    const onError = (payload: FilesDownloadErrorPayload) => {
      if (!payload.requestId || !downloadRequestIdsRef.current.has(payload.requestId)) return;
      downloadRequestIdsRef.current.delete(payload.requestId);
      const { addToast } = useNotificationStore.getState();
      const where = payload.path ? ` (${payload.path})` : '';
      addToast('Download failed', `${payload.error}${where}`);
    };
    socket.on(FILES_DOWNLOAD_READY, onReady);
    socket.on(FILES_DOWNLOAD_ERROR, onError);
    return () => {
      socket.off(FILES_DOWNLOAD_READY, onReady);
      socket.off(FILES_DOWNLOAD_ERROR, onError);
    };
  }, [socket, agentId, handleDownloadReady]);

  const dismissDownload = useCallback((id: number) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleChatFileDownload = useCallback(
    (rawPath: string) => {
      if (!socket) return;
      const resolved = resolveFilePath(rawPath, convProjectRef.current);
      const requestId = crypto.randomUUID();
      downloadRequestIdsRef.current.add(requestId);
      socket.emit(FILES_DOWNLOAD, { agentId, path: resolved, requestId });
    },
    [socket, agentId]
  );

  const handlePromptAction = useCallback(
    (optionNumber: number) => {
      const prompt = terminalPromptRef.current;
      if (!prompt) return;
      const keys = buildPromptSelectionKeys(prompt, optionNumber);
      write(keys);
      // Optimistically clear; the next detection run will refresh it if the
      // prompt is still showing for any reason.
      terminalPromptRef.current = null;
      setTerminalPrompt(null);
      // Responding to a prompt restarts Claude's work cycle
      claudeTurnRef.current = 'user_sent';
      claudeNotifiedRef.current = false;
    },
    [write]
  );

  const scrollTtyToBottom = useCallback(() => {
    termRef.current?.scrollToBottom();
    setTtyScrolledUp(false);
  }, []);

  // Send data in small chunks with delays to avoid PTY buffer overflow
  const writeChunked = useCallback((data: string, onDone?: () => void) => {
    const CHUNK = 256;
    if (data.length <= CHUNK) {
      write(data);
      onDone?.();
      return;
    }
    let offset = 0;
    const next = () => {
      const end = Math.min(offset + CHUNK, data.length);
      write(data.slice(offset, end));
      offset = end;
      if (offset < data.length) {
        setTimeout(next, 10);
      } else {
        onDone?.();
      }
    };
    next();
  }, [write]);

  const handleComposeSend = useCallback(() => {
    if (!composeText) return;
    if (convProjectRef.current) {
      setPendingSent((prev) => [...prev, composeText]);
      // Mark start of a new Claude turn for completion detection
      claudeTurnRef.current = 'user_sent';
      claudeNotifiedRef.current = false;
    }
    // Send line by line to avoid PTY buffer overflow
    // Each line is typed, then \n to add newline, final \r to submit
    const lines = composeText.split('\n');
    if (lines.length > 1) {
      let i = 0;
      const sendLine = () => {
        write(lines[i]);
        i++;
        if (i < lines.length) {
          // Newline between lines (not submit)
          setTimeout(() => {
            write('\n');
            setTimeout(sendLine, 30);
          }, 10);
        } else {
          // Submit
          setTimeout(() => write('\r'), 30);
        }
      };
      sendLine();
    } else {
      write(composeText + '\r');
    }
    setComposeText('');
    composeRef.current?.focus();
  }, [composeText, write]);

  const handleComposeRaw = useCallback(() => {
    if (!composeText) return;
    if (convProjectRef.current) {
      setPendingSent((prev) => [...prev, composeText]);
    }
    const lines = composeText.split('\n');
    if (lines.length > 1) {
      let i = 0;
      const sendLine = () => {
        write(lines[i]);
        i++;
        if (i < lines.length) {
          setTimeout(() => {
            write('\n');
            setTimeout(sendLine, 30);
          }, 10);
        }
      };
      sendLine();
    } else {
      write(composeText);
    }
    setComposeText('');
    composeRef.current?.focus();
  }, [composeText, write]);

  return (
    <div className="flex flex-col h-[calc(100dvh-52px)]">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleUpload}
      />

      {/* Toolbar — always visible, never scrolls */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-surface border-b border-border overflow-x-auto flex-shrink-0 z-20">
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
            title="Raw terminal mode (direct keyboard)"
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
        {/* xterm.js terminal — visible in TTY mode or when no conversation */}
        <div
          ref={termContainerRef}
          className={`absolute inset-0 pl-1 ${!rawMode && convProjectRef.current ? 'invisible' : ''}`}
        />

        {/* TTY overlay: prompt banner + scroll-to-bottom button, only when xterm is visible */}
        {(rawMode || !convProjectRef.current) && (
          <>
            {terminalPrompt && (
              <div className="absolute left-2 right-2 bottom-2 z-[6] bg-surface-deep/95 backdrop-blur border border-yellow-500/40 rounded-xl p-2.5 shadow-xl">
                <div className="text-xs text-yellow-400 font-medium mb-2 break-words">
                  {terminalPrompt.question}
                </div>
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                  {terminalPrompt.options.map((opt) => (
                    <button
                      key={opt.number}
                      onClick={() => handlePromptAction(opt.number)}
                      className={`w-full text-left px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        opt.selected
                          ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300'
                          : 'bg-surface-raised border-border-subtle text-text-secondary hover:bg-surface-overlay'
                      }`}
                    >
                      <span className="font-mono text-text-muted mr-2">{opt.number}.</span>
                      {opt.text}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {ttyScrolledUp && (
              <button
                type="button"
                onClick={scrollTtyToBottom}
                className="absolute bottom-3 right-3 z-[7] w-10 h-10 rounded-full bg-surface-overlay/95 backdrop-blur border border-border text-text-secondary hover:text-accent hover:border-accent shadow-lg flex items-center justify-center transition-colors"
                title="Scroll to bottom"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </>
        )}

        {/* Chat view — visible in compose mode when we have a conversation */}
        {!rawMode && convProjectRef.current && (
          <div className="absolute inset-0 flex flex-col bg-surface-deep z-[3]">
            <ChatView
              messages={convMessages}
              pendingSent={pendingSent}
              terminalPrompt={terminalPrompt}
              onPromptAction={handlePromptAction}
              onFileDownload={handleChatFileDownload}
            />
          </div>
        )}

        {/* Touch blocker when showing terminal in compose mode (no conversation) */}
        {!rawMode && !convProjectRef.current && (
          <div
            className="absolute inset-0 z-[5]"
            onClick={() => composeRef.current?.focus()}
          />
        )}

        {/* File explorer overlay */}
        {showFiles && (
          <div className="absolute inset-0 md:left-auto md:w-80 z-10">
            <FileExplorer
              socket={socket}
              agentId={agentId || ''}
              initialPath={initialPath}
              onClose={() => setShowFiles(false)}
            />
          </div>
        )}
      </div>

      {/* Download notifications */}
      <FileNotifications downloads={downloads} onDismiss={dismissDownload} />

      {/* Compose input — visible in compose mode */}
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
