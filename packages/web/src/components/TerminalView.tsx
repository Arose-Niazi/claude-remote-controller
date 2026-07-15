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
  CLAUDE_SESSIONS_LIST,
  CLAUDE_SESSIONS_RESULT,
  FILES_DOWNLOAD,
  FILES_DOWNLOAD_READY,
  FILES_DOWNLOAD_ERROR,
} from '@crc/shared';
import { useNotificationStore } from '../stores/notificationStore';
import { showBrowserNotification, playSound, flashTitle, claudeDedup } from '../lib/notify';
import type {
  ClaudeConvMessage,
  ClaudeConvDataPayload,
  ClaudeSessionsResultPayload,
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
  detectClaudeWorking,
  detectClaudeInputText,
  detectClaudeChrome,
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
  // For a freshly-launched `claude` (no --resume): the set of session ids that
  // already existed at launch. The conversation poller must not latch onto one
  // of these (that's an OLD chat) — it waits for the new session this launch
  // creates. null means "not a fresh launch" (resume/reattach), so no guard.
  const preexistingSessionsRef = useRef<Set<string> | null>(null);
  // Whether the pre-existing-session baseline has loaded (or timed out). Until
  // then, a fresh launch defers latching so it can't grab an old chat that the
  // first poll returns before the baseline arrives.
  const baselineLoadedRef = useRef(false);
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

  // Claude completion detection, driven by the "esc to interrupt" working line
  // in the terminal (cross-platform, needs no shell hook).
  const claudeWorkingRef = useRef(false);
  const doneTimerRef = useRef<number | null>(null);
  // Last interactive-prompt question we alerted on, so the same prompt staying
  // on screen (or its selection cursor moving) doesn't re-notify.
  const lastPromptQuestionRef = useRef<string | null>(null);
  // Mirror of Claude's TUI input line into the compose bar. Armed briefly by
  // ESC/↑/↓ taps (interrupt-restore, history cycling). Set-only: it never
  // clears the bar, never injects keys, and never overwrites text the user
  // typed themselves (only empty or previously-mirrored bar content).
  const mirrorArmedUntilRef = useRef(0);
  const lastMirroredRef = useRef('');
  const composeTextRef = useRef('');
  // Consecutive armed-window reads that found the composer empty — two in a
  // row means the user cleared it in the TUI, so the bar text becomes theirs.
  const emptyMirrorReadsRef = useRef(0);
  // Only mirror in terminals that have shown Claude UI ("esc to interrupt" or
  // a numbered menu) — a plain shell's "❯"/">" prompt must not feed the bar.
  const sawClaudeRef = useRef(false);
  const rawModeRef = useRef(false);
  // Per-category cooldown so the same kind of alert can't repeat within 10s,
  // while distinct kinds (input vs done) never block each other.
  const NOTIFY_COOLDOWN = 10_000;
  const lastNotifyByCategoryRef = useRef<Map<string, number>>(new Map());
  const canNotify = useCallback((category: string, now = Date.now()) => {
    const map = lastNotifyByCategoryRef.current;
    const last = map.get(category) || 0;
    if (now - last < NOTIFY_COOLDOWN) return false;
    // Bound growth — keys can include per-question dedup keys over a long session.
    if (map.size > 100) map.delete(map.keys().next().value as string);
    map.set(category, now);
    return true;
  }, []);
  // Central notification gate: always show a brief in-app toast, but only buzz
  // the OS / play a sound / flash the title when the app is NOT focused — so we
  // never interrupt the user while they're already watching the terminal.
  const fireNotification = useCallback(
    (title: string, body: string, category: string, dedupKey?: string) => {
      const { enabled, addToast } = useNotificationStore.getState();
      if (!enabled) return;
      // dedupKey lets distinct prompts (different questions) each alert while the
      // same one is still throttled; without it the whole category is throttled.
      if (!canNotify(dedupKey ? `${category}:${dedupKey}` : category)) return;
      addToast(title, body);
      // Only buzz the OS / play a sound when the user isn't actively watching
      // this tab (more reliable on mobile than hasFocus alone).
      const watching = document.visibilityState === 'visible' && document.hasFocus();
      if (!watching) {
        showBrowserNotification(title, body);
        playSound();
        flashTitle(title);
      }
    },
    [canNotify]
  );

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

      // Completion detection: watch Claude's "esc to interrupt" working line.
      // When it disappears (turn ended), debounce briefly then notify — unless
      // Claude resumed or a prompt is waiting for input (handled separately).
      const wasWorking = claudeWorkingRef.current;
      const working = detectClaudeWorking(term);
      claudeWorkingRef.current = working;
      if (
        working ||
        detected ||
        (!sawClaudeRef.current && detectClaudeChrome(term))
      ) {
        sawClaudeRef.current = true;
      }
      if (working) {
        if (doneTimerRef.current !== null) {
          window.clearTimeout(doneTimerRef.current);
          doneTimerRef.current = null;
        }
      } else if (wasWorking && doneTimerRef.current === null) {
        doneTimerRef.current = window.setTimeout(() => {
          doneTimerRef.current = null;
          const t = termRef.current;
          if (!t || detectClaudeWorking(t)) return; // Claude resumed
          if (terminalPromptRef.current) return;     // a prompt is up
          // Coalesce with the server hook broadcast (CLAUDE_NOTIFY) if it fired.
          if (!claudeDedup('done')) return;
          fireNotification('Claude finished', 'Ready for your next prompt', 'claude-done');
        }, 3000);
      }

      // Compose-bar mirror: after ESC/↑/↓, Claude redraws its input line with
      // the restored/cycled text — reflect it into the bar. Skipped while a
      // numbered menu is up ("❯" there marks the selected option), in raw
      // mode, and in terminals that have never shown Claude UI.
      if (
        Date.now() < mirrorArmedUntilRef.current &&
        !rawModeRef.current &&
        !terminalPromptRef.current &&
        (sawClaudeRef.current || convProjectRef.current || convClaudeSessionRef.current)
      ) {
        const inputText = detectClaudeInputText(term);
        const current = composeTextRef.current;
        if (inputText) {
          emptyMirrorReadsRef.current = 0;
          // A strict prefix of what we already mirrored is a caret-moved-left
          // artifact (the scrape cuts at the caret), not new input.
          const caretArtifact =
            inputText !== lastMirroredRef.current &&
            lastMirroredRef.current.startsWith(inputText);
          if (
            !caretArtifact &&
            inputText !== current &&
            (current === '' || current === lastMirroredRef.current)
          ) {
            lastMirroredRef.current = inputText;
            composeTextRef.current = inputText;
            setComposeText(inputText);
          }
        } else if (
          current !== '' &&
          current === lastMirroredRef.current &&
          ++emptyMirrorReadsRef.current >= 2
        ) {
          // Composer seen empty twice in a row — the user cleared it in the
          // TUI. Keep the bar text but drop its "mirrored" status/hint.
          lastMirroredRef.current = '';
        }
      }

      // Keep the scrolled-up indicator fresh on new output too
      const buf = term.buffer.active;
      setTtyScrolledUp(buf.viewportY < buf.baseY);
    }, 80);
  }, [fireNotification]);

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

  // Notify when Claude shows an interactive prompt (permission / selection),
  // once per distinct question so a moving selection cursor or redraw doesn't
  // re-alert. Works in raw and chat mode alike.
  useEffect(() => {
    if (!terminalPrompt) {
      lastPromptQuestionRef.current = null;
      return;
    }
    const question = terminalPrompt.question || 'Waiting for your response';
    if (question === lastPromptQuestionRef.current) return;
    lastPromptQuestionRef.current = question;
    // A real prompt means Claude isn't "working" — cancel any pending done alert.
    claudeWorkingRef.current = false;
    if (doneTimerRef.current !== null) {
      window.clearTimeout(doneTimerRef.current);
      doneTimerRef.current = null;
    }
    // Coalesce with the server permission_request broadcast (short window so two
    // genuinely different prompts still both alert).
    if (!claudeDedup('input', 3000)) return;
    fireNotification('Claude needs input', question, 'claude-input', question);
  }, [terminalPrompt, fireNotification]);

  // Clear stale pending messages after 30 seconds
  useEffect(() => {
    if (pendingSent.length === 0) return;
    const timer = setTimeout(() => setPendingSent([]), 30000);
    return () => clearTimeout(timer);
  }, [pendingSent]);

  // Keep refs in sync
  useEffect(() => { ctrlRef.current = ctrlActive; }, [ctrlActive]);
  useEffect(() => { altRef.current = altActive; }, [altActive]);
  useEffect(() => { composeTextRef.current = composeText; }, [composeText]);
  useEffect(() => { rawModeRef.current = rawMode; }, [rawMode]);

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

    // OSC 777 notifications from Claude Code hooks (Mac/Linux, where the bash
    // notify plugin is installed). On Windows these never arrive — the working-
    // line detector covers completion there instead. Routed through the same
    // 'claude-done' / 'claude-input' categories so they don't double-fire with
    // the terminal-based detectors.
    // Format: \033]777;notify;<prefix>;<JSON>\007
    const oscDisposable = term.parser.registerOscHandler(777, (data) => {
      const parts = data.split(';');
      if (parts[0] !== 'notify' || parts.length < 2) return false;
      const rawTitle = parts[1] || '';
      const rawBody = parts.slice(2).join(';') || '';

      if (rawTitle === 'crc://agent' || rawTitle === 'warp://cli-agent') {
        try {
          const payload = JSON.parse(rawBody);
          const event = payload.event as string;
          if (event === 'stop' || event === 'idle_prompt') {
            // Coalesce with the server hook broadcast + working-line detector.
            if (claudeDedup('done')) {
              fireNotification('Claude finished', 'Ready for your next prompt', 'claude-done');
            }
          }
          // permission_request is handled by the universal terminal prompt
          // detector (so it works on Windows too and can't double-fire here).
          // prompt_submit / tool_complete are informational — no alert.
        } catch {
          // ignore malformed
        }
      } else {
        // Generic OSC 777 notification from some other tool.
        fireNotification(rawTitle, rawBody, 'osc-plain');
      }

      return true; // handled — suppress from terminal display
    });

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientationChange);
      scrollDisposable.dispose();
      oscDisposable.dispose();
      if (promptCheckTimerRef.current !== null) {
        window.clearTimeout(promptCheckTimerRef.current);
        promptCheckTimerRef.current = null;
      }
      if (doneTimerRef.current !== null) {
        window.clearTimeout(doneTimerRef.current);
        doneTimerRef.current = null;
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
      // ?tmux=<name>&launch=<cmd> creates/attaches a shared tmux session (mirrors
      // what runs in Warp/tmux on the PC).
      const tmux = searchParams.get('tmux') || undefined;
      const launch = searchParams.get('launch') || undefined;
      // Name tmux mirrors after their target so they're identifiable in the
      // session list (instead of the generic "Session N").
      create(term.cols, term.rows, tmux ? `tmux: ${tmux}` : undefined, tmux ? { tmux, launch } : undefined);
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
      // Fresh `claude` launch (not a resume): mark it so the poller waits for
      // the NEW session instead of showing whichever chat is currently newest.
      if (!resumeMatch && /\bclaude\b/.test(initialCmd)) {
        preexistingSessionsRef.current = new Set();
      }
    }
  }, [initialCmd]);

  // Baseline the project's existing Claude session ids so the poller can tell
  // this launch's new session apart from pre-existing ones (clock-skew safe —
  // we compare ids, not timestamps).
  useEffect(() => {
    if (!socket || !agentId || !preexistingSessionsRef.current) return;
    const project = convProjectRef.current;
    if (!project) return;
    const onResult = (p: ClaudeSessionsResultPayload) => {
      if (p.agentId && p.agentId !== agentId) return;
      if (preexistingSessionsRef.current && !baselineLoadedRef.current) {
        preexistingSessionsRef.current = new Set((p.sessions || []).map((s) => s.sessionId));
        baselineLoadedRef.current = true;
      }
    };
    socket.on(CLAUDE_SESSIONS_RESULT, onResult);
    socket.emit(CLAUDE_SESSIONS_LIST, { agentId, projectPath: project });
    // Fallback: if the baseline never arrives, stop deferring after 5s so the
    // conversation still shows (worst case it may latch onto the latest chat).
    const fallback = window.setTimeout(() => {
      baselineLoadedRef.current = true;
    }, 5000);
    // Safety valve: drop the guard entirely after 15s so a mis-baselined new
    // session (e.g. its transcript existed before the baseline read) can never
    // leave the view permanently stuck with nothing to latch onto.
    const disarm = window.setTimeout(() => {
      if (!convClaudeSessionRef.current) preexistingSessionsRef.current = null;
    }, 15000);
    return () => {
      socket.off(CLAUDE_SESSIONS_RESULT, onResult);
      window.clearTimeout(fallback);
      window.clearTimeout(disarm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, agentId, initialCmd]);

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
      // On a fresh `claude` launch, ignore data from a session that already
      // existed at launch — it's an old chat that merely happens to be the
      // newest transcript until our new session writes its first line.
      const preexisting = preexistingSessionsRef.current;
      if (preexisting && !convClaudeSessionRef.current) {
        // Defer until the baseline is known, then skip pre-existing (old) chats.
        if (!baselineLoadedRef.current) return;
        if (payload.sessionId && preexisting.has(payload.sessionId)) return;
      }
      // Lock onto the session ID once discovered (for new sessions without --resume).
      // Read the terminal sessionId from the ref so a session that was 'new'
      // when this listener was registered still gets the localStorage write
      // once the server assigns it an id.
      if (payload.sessionId && !convClaudeSessionRef.current) {
        convClaudeSessionRef.current = payload.sessionId;
        preexistingSessionsRef.current = null; // locked — guard no longer needed
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
      }
      // Completion is detected from the terminal working line (see
      // schedulePromptCheck), so no JSONL-idle heuristic is needed here.
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
      if (rawMode) {
        termRef.current?.focus();
        return;
      }
      // ESC restores an interrupted message into Claude's own input line and
      // ↑/↓ cycle its history — arm the mirror so the compose bar picks up
      // the redrawn input line when the echo comes back.
      if (data === '\x1b' || data === '\x1b[A' || data === '\x1b[B') {
        mirrorArmedUntilRef.current = Date.now() + 2500;
        emptyMirrorReadsRef.current = 0;
      }
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
      // The prompt-notify effect resets lastPromptQuestionRef when the prompt
      // clears, so the next distinct prompt will alert again.
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
    }
    // Send line by line to avoid PTY buffer overflow. Each line is typed, then
    // \n to add a newline; the final Enter is sent SEPARATELY after a delay.
    // Claude Code 2.x's paste heuristic folds an Enter arriving in the same
    // burst as the text into the input as a newline instead of submitting, so
    // the prompt would sit there unsent — the gap makes it a real submit.
    const lines = composeText.split('\n');
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
        setTimeout(() => write('\r'), 120); // submit, clearly separated
      }
    };
    sendLine();
    setComposeText('');
    lastMirroredRef.current = '';
    // Sending ends the interaction the mirror was armed for — don't let the
    // echo of the just-sent text repopulate the bar.
    mirrorArmedUntilRef.current = 0;
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
    lastMirroredRef.current = '';
    mirrorArmedUntilRef.current = 0;
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
              onChange={(e) => {
                // Sync the ref in the same task — the mirror's timer must
                // never see a stale value and overwrite fresh user typing.
                composeTextRef.current = e.target.value;
                setComposeText(e.target.value);
              }}
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
            {composeText !== '' && composeText === lastMirroredRef.current ? (
              <span className="text-[10px] text-claude/80">
                copied from Claude's input — ESC clears it there
              </span>
            ) : (
              <span className="text-[10px] text-text-muted/50">Shift+Enter for newline</span>
            )}
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
