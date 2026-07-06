import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { SESSION_LIST, SESSION_KILL, SESSION_KILL_ALL, SESSION_RENAME, AGENT_EXEC, AGENT_EXEC_RESULT, TMUX_LIST, TMUX_LIST_RESULT } from '@crc/shared';
import type { TerminalSession, AgentExecResultPayload, TmuxSessionInfo, TmuxListResultPayload } from '@crc/shared';
import { useSessionStore } from '../stores/sessionStore';
import VpnPanel from './VpnPanel';
import ClaudeSessions from './ClaudeSessions';
import FileExplorer from './FileExplorer';
import TmuxPanel from './TmuxPanel';
import { useAgentStore } from '../stores/agentStore';

interface SessionManagerProps {
  socket: Socket | null;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SessionManager({ socket }: SessionManagerProps) {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const sessions = useSessionStore((s) => s.sessions);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [showVpn, setShowVpn] = useState(false);
  const [showClaude, setShowClaude] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [showTmux, setShowTmux] = useState(false);
  const [permPrompt, setPermPrompt] = useState<{ path: string } | null>(null);
  // tmux sessions on the agent machine, shown inline so mirroring one doesn't
  // require opening the Warp overlay.
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSessionInfo[]>([]);
  const tmuxReqRef = useRef<string | null>(null);
  const agents = useAgentStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const browseInitialPath = agent?.homeDirectory || '/';

  // Holds the in-flight settings-write result listener so we can detach it when
  // the user cancels, on unmount, or once it fires.
  const settingsResultRef = useRef<((payload: AgentExecResultPayload) => void) | null>(null);

  const detachSettingsListener = () => {
    if (settingsResultRef.current) {
      socket?.off(AGENT_EXEC_RESULT, settingsResultRef.current);
      settingsResultRef.current = null;
    }
  };

  const agentSessions = sessions.filter((s) => s.agentId === agentId);

  useEffect(() => {
    if (socket && agentId) {
      socket.emit(SESSION_LIST, { agentId });
    }
  }, [socket, agentId]);

  // Fetch the machine's tmux sessions for the inline list. Re-fetched when the
  // tab regains focus so the list stays fresh without a manual refresh.
  useEffect(() => {
    if (!socket || !agentId) return;
    const request = () => {
      const requestId = crypto.randomUUID();
      tmuxReqRef.current = requestId;
      socket.emit(TMUX_LIST, { agentId, requestId });
    };
    const onResult = (p: TmuxListResultPayload) => {
      if (p.requestId && p.requestId !== tmuxReqRef.current) return;
      if (p.agentId && p.agentId !== agentId) return;
      const list = p.error ? [] : p.sessions || [];
      setTmuxSessions([...list].sort((a, b) => (b.activity || 0) - (a.activity || 0)));
    };
    const onFocus = () => request();
    socket.on(TMUX_LIST_RESULT, onResult);
    window.addEventListener('focus', onFocus);
    request();
    return () => {
      socket.off(TMUX_LIST_RESULT, onResult);
      window.removeEventListener('focus', onFocus);
    };
  }, [socket, agentId]);

  // Clean up any pending settings-write listener on unmount.
  useEffect(() => {
    return () => {
      if (settingsResultRef.current) {
        socket?.off(AGENT_EXEC_RESULT, settingsResultRef.current);
        settingsResultRef.current = null;
      }
    };
  }, [socket]);

  function handleCreate() {
    navigate(`/terminal/${agentId}/new`);
  }

  function handleMirror(name: string) {
    navigate(`/terminal/${agentId}/new?tmux=${encodeURIComponent(name)}`);
  }

  function handleConnect(session: TerminalSession) {
    navigate(`/terminal/${agentId}/${session.id}`);
  }

  function handleKill(sessionId: string) {
    socket?.emit(SESSION_KILL, { sessionId });
  }

  function handleKillAll() {
    if (agentId) socket?.emit(SESSION_KILL_ALL, { agentId });
  }

  function handleRename(sessionId: string) {
    if (newName.trim()) {
      socket?.emit(SESSION_RENAME, { sessionId, name: newName.trim() });
      setRenaming(null);
      setNewName('');
    }
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-3 min-w-0">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex-shrink-0 px-3 py-1.5 text-sm bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
          >
            ←
          </button>
          <h2 className="text-lg font-medium text-text truncate min-w-0">{agentId}</h2>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setShowClaude(true)}
            className="flex-shrink-0 whitespace-nowrap px-4 py-1.5 text-sm bg-claude hover:bg-claude-hover text-white rounded-lg transition-colors"
          >
            Claude
          </button>
          <button
            onClick={() => setShowTmux(true)}
            className="flex-shrink-0 whitespace-nowrap px-4 py-1.5 text-sm bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
            title="Mirror a Warp/tmux session"
          >
            Warp
          </button>
          <button
            onClick={() => setShowBrowse(true)}
            className="flex-shrink-0 whitespace-nowrap px-4 py-1.5 text-sm bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
          >
            Browse
          </button>
          <button
            onClick={() => setShowVpn(true)}
            className="flex-shrink-0 whitespace-nowrap px-4 py-1.5 text-sm bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
          >
            VPN
          </button>
        </div>
      </div>

      {showVpn && agentId && (
        <VpnPanel socket={socket} agentId={agentId} onClose={() => setShowVpn(false)} />
      )}

      {showClaude && agentId && (
        <ClaudeSessions socket={socket} agentId={agentId} onClose={() => setShowClaude(false)} />
      )}

      {showTmux && agentId && (
        <TmuxPanel socket={socket} agentId={agentId} onClose={() => setShowTmux(false)} />
      )}

      {showBrowse && agentId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl h-[80vh] overflow-hidden">
            <FileExplorer
              socket={socket}
              agentId={agentId}
              initialPath={browseInitialPath}
              onClose={() => setShowBrowse(false)}
              onStartClaude={(path, hasClaudeSettings) => {
                if (hasClaudeSettings) {
                  setShowBrowse(false);
                  const cmd = `cd ${JSON.stringify(path)} && claude`;
                  navigate(`/terminal/${agentId}/new?cmd=${encodeURIComponent(cmd)}`);
                } else {
                  setPermPrompt({ path });
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Permission mode prompt when starting Claude in a new project */}
      {permPrompt && agentId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-5">
            <h3 className="text-sm font-semibold text-text mb-1">Setup Claude</h3>
            <p className="text-xs text-text-muted mb-4">
              No <code className="text-accent">.claude/settings.json</code> found in this project. Choose a permission mode:
            </p>
            <div className="space-y-2">
              {[
                { mode: 'bypassPermissions', label: 'Bypass Permissions', desc: 'No confirmation prompts (fastest)' },
                { mode: 'default', label: 'Default', desc: 'Ask before risky operations' },
                { mode: 'plan', label: 'Plan Mode', desc: 'Read-only, suggest changes only' },
              ].map(({ mode, label, desc }) => (
                <button
                  key={mode}
                  onClick={() => {
                    if (!socket) return;
                    const settingsJson = JSON.stringify(
                      { permissions: { defaultMode: mode }, effortLevel: 'high' },
                      null,
                      4
                    );
                    const targetPath = permPrompt.path;
                    let cmd: string;
                    if (agent?.platform === 'win32') {
                      // PowerShell: create the .claude dir and write settings.json.
                      // Single-quote escaping for PowerShell is doubling the quote.
                      const psEscape = (s: string) => s.replace(/'/g, "''");
                      const dir = `${targetPath}\\.claude`;
                      const file = `${targetPath}\\.claude\\settings.json`;
                      cmd =
                        `New-Item -ItemType Directory -Force -Path '${psEscape(dir)}' | Out-Null; ` +
                        `Set-Content -Path '${psEscape(file)}' -Value '${psEscape(settingsJson)}' -Encoding utf8`;
                    } else {
                      const shEscape = (s: string) => s.replace(/'/g, "'\\''");
                      const escapedJson = shEscape(settingsJson);
                      const escapedPath = shEscape(targetPath);
                      cmd = `mkdir -p '${escapedPath}/.claude' && echo '${escapedJson}' > '${escapedPath}/.claude/settings.json'`;
                    }
                    const requestId = crypto.randomUUID();
                    socket.emit(AGENT_EXEC, { agentId, command: cmd, cwd: targetPath, requestId });

                    // Detach any earlier pending listener, then listen for the
                    // matching result before navigating.
                    detachSettingsListener();
                    const onResult = (payload: AgentExecResultPayload) => {
                      if (payload.requestId !== requestId) return;
                      detachSettingsListener();
                      setPermPrompt(null);
                      setShowBrowse(false);
                      const startCmd = `cd ${JSON.stringify(targetPath)} && claude`;
                      navigate(`/terminal/${agentId}/new?cmd=${encodeURIComponent(startCmd)}`);
                    };
                    settingsResultRef.current = onResult;
                    socket.on(AGENT_EXEC_RESULT, onResult);
                  }}
                  className="w-full text-left px-4 py-3 rounded-xl border border-border-subtle bg-surface-raised hover:border-accent hover:bg-surface-overlay transition-colors"
                >
                  <div className="text-sm font-medium text-text">{label}</div>
                  <div className="text-xs text-text-muted">{desc}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                detachSettingsListener();
                setPermPrompt(null);
              }}
              className="w-full mt-3 py-1.5 text-xs text-text-muted hover:text-text transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <button
        onClick={handleCreate}
        className="w-full mb-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-medium transition-colors"
      >
        + New Session
      </button>

      {agentSessions.length === 0 ? (
        <div className="text-text-muted text-center py-8 text-sm">
          No active sessions. Create one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {agentSessions.map((session) => (
            <div
              key={session.id}
              className="rounded-2xl border border-border bg-surface-raised p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {renaming === session.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRename(session.id);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        autoFocus
                        className="px-2 py-0.5 bg-surface-deep border border-border-subtle rounded text-sm text-text w-36 focus:outline-none focus:border-accent"
                      />
                      <button
                        type="submit"
                        className="text-xs text-accent hover:text-accent-hover"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming(null)}
                        className="text-xs text-text-muted hover:text-text-secondary"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <span className="font-medium text-sm text-text">{session.name}</span>
                  )}
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                    session.status === 'attached'
                      ? 'bg-green-500/15 text-green-400'
                      : session.status === 'detached'
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}
                >
                  {session.status}
                </span>
              </div>

              <div className="text-xs text-text-muted mb-3">
                Created {timeAgo(session.createdAt)}
              </div>

              <div className="flex gap-2">
                {renaming !== session.id && (
                  <button
                    onClick={() => {
                      setRenaming(session.id);
                      setNewName(session.name);
                    }}
                    className="px-3 py-1.5 text-xs bg-surface-overlay hover:bg-surface-overlay/80 border border-border-subtle text-text-secondary rounded-lg transition-colors"
                  >
                    Rename
                  </button>
                )}
                <button
                  onClick={() => handleConnect(session)}
                  className="px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                >
                  Connect
                </button>
                <button
                  onClick={() => handleKill(session.id)}
                  className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                >
                  Kill
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {agentSessions.length > 0 && (
        <button
          onClick={handleKillAll}
          className="w-full mt-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-sm transition-colors"
        >
          Kill All Sessions
        </button>
      )}

      {tmuxSessions.length > 0 && (
        <div className="mt-6">
          <div className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            Warp / tmux on this machine
          </div>
          <div className="space-y-3">
            {tmuxSessions.map((s) => (
              <button
                key={s.name}
                onClick={() => handleMirror(s.name)}
                className="w-full text-left rounded-2xl border border-border bg-surface-raised p-4 hover:border-accent hover:bg-surface-overlay transition-colors flex items-center justify-between"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text font-mono truncate">{s.name}</div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    {s.windows} window{s.windows === 1 ? '' : 's'}
                    {s.attached ? ' · attached on PC' : ''}
                  </div>
                </div>
                <span className="text-xs text-accent flex-shrink-0 ml-3">Mirror →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
