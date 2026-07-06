import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { TMUX_LIST, TMUX_LIST_RESULT, TMUX_KILL, TMUX_KILL_RESULT } from '@crc/shared';
import type { TmuxListResultPayload, TmuxKillResultPayload, TmuxSessionInfo } from '@crc/shared';
import { useAgentStore } from '../stores/agentStore';
import { useNotificationStore } from '../stores/notificationStore';

interface TmuxPanelProps {
  socket: Socket | null;
  agentId: string;
  onClose: () => void;
}

/**
 * Lists tmux sessions on the agent so the phone can mirror one — the SAME
 * session the user has open in Warp/tmux on the PC. "Mirror" opens it as a
 * live terminal (see output, re-prompt); the PC stays attached, so both drive
 * the same run.
 */
export default function TmuxPanel({ socket, agentId, onClose }: TmuxPanelProps) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<TmuxSessionInfo[]>([]);
  const agents = useAgentStore((s) => s.agents);
  const homeDir = agents.find((a) => a.id === agentId)?.homeDirectory || '';
  const shortPath = (p?: string) =>
    p && homeDir && p.startsWith(homeDir) ? `~${p.slice(homeDir.length)}` : p || '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reqRef = useRef<string | null>(null);

  const refresh = () => {
    if (!socket) return;
    setLoading(true);
    setError('');
    const requestId = crypto.randomUUID();
    reqRef.current = requestId;
    socket.emit(TMUX_LIST, { agentId, requestId });
  };

  useEffect(() => {
    if (!socket) return;
    const onResult = (p: TmuxListResultPayload) => {
      if (p.requestId && p.requestId !== reqRef.current) return;
      if (p.agentId && p.agentId !== agentId) return;
      setLoading(false);
      setError(p.error || '');
      setSessions(p.sessions || []);
    };
    const onKillResult = (p: TmuxKillResultPayload) => {
      if (p.agentId && p.agentId !== agentId) return;
      if (!p.ok) {
        useNotificationStore.getState().addToast('tmux kill failed', p.error || 'Unknown error');
      }
      refresh();
    };
    socket.on(TMUX_LIST_RESULT, onResult);
    socket.on(TMUX_KILL_RESULT, onKillResult);
    refresh();
    return () => {
      socket.off(TMUX_LIST_RESULT, onResult);
      socket.off(TMUX_KILL_RESULT, onKillResult);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, agentId]);

  const mirror = (name: string) =>
    navigate(`/terminal/${agentId}/new?tmux=${encodeURIComponent(name)}`);
  const kill = (name: string) => {
    if (
      !window.confirm(
        `Kill tmux session "${name}"? Everything running inside it (including Claude) will be terminated.`
      )
    ) {
      return;
    }
    socket?.emit(TMUX_KILL, { agentId, name, requestId: crypto.randomUUID() });
  };
  const startSharedClaude = () =>
    navigate(`/terminal/${agentId}/new?tmux=claude&launch=${encodeURIComponent('claude')}`);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-text">Shared sessions (Warp / tmux)</h3>
          <div className="flex items-center gap-2">
            <button onClick={refresh} className="text-xs text-text-muted hover:text-text" title="Refresh">
              ↻
            </button>
            <button onClick={onClose} className="text-xs text-text-muted hover:text-text">
              ✕
            </button>
          </div>
        </div>
        <p className="text-xs text-text-muted mb-3">
          Mirror a tmux session you have open in Warp — you'll see live output and can re-prompt; your
          PC stays attached to the same run.
        </p>

        {loading ? (
          <div className="text-center text-text-muted text-sm py-6">Loading…</div>
        ) : error ? (
          <div className="text-center text-red-400 text-xs py-4">{error}</div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-text-muted text-xs py-4">
            No tmux sessions found. Start one on your PC (e.g. <code className="text-accent">tmux new -s claude</code>)
            or use the button below.
          </div>
        ) : (
          <div className="space-y-2 mb-3">
            {sessions.map((s) => (
              <div
                key={s.name}
                className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface-raised flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text font-mono truncate">{s.name}</div>
                  <div className="text-[11px] text-text-muted truncate">
                    {[
                      shortPath(s.path),
                      `${s.windows} window${s.windows === 1 ? '' : 's'}`,
                      s.attached ? 'attached on PC' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {s.claudeTitle && (
                    <div className="text-[11px] text-claude truncate">
                      ✳ {s.claudeTitle}
                      {s.claudeStatus ? ` · ${s.claudeStatus}` : ''}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    onClick={() => mirror(s.name)}
                    className="px-2.5 py-1 text-xs bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                  >
                    Mirror
                  </button>
                  <button
                    onClick={() => kill(s.name)}
                    className="px-2.5 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                  >
                    Kill
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={startSharedClaude}
          className="w-full mt-1 py-2 bg-claude hover:bg-claude-hover text-white rounded-xl text-sm font-medium transition-colors"
        >
          Start shared Claude session
        </button>
        <p className="text-[11px] text-text-muted mt-2 text-center">
          Then attach from Warp: <code className="text-accent">tmux attach -t claude</code>
        </p>
      </div>
    </div>
  );
}
