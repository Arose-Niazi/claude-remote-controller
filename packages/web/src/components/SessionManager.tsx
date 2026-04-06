import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { SESSION_LIST, SESSION_KILL, SESSION_KILL_ALL, SESSION_RENAME } from '@crc/shared';
import type { TerminalSession } from '@crc/shared';
import { useSessionStore } from '../stores/sessionStore';
import VpnPanel from './VpnPanel';
import ClaudeSessions from './ClaudeSessions';

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

  const agentSessions = sessions.filter((s) => s.agentId === agentId);

  useEffect(() => {
    if (socket && agentId) {
      socket.emit(SESSION_LIST, { agentId });
    }
  }, [socket, agentId]);

  function handleCreate() {
    navigate(`/terminal/${agentId}/new`);
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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
          >
            ← Back
          </button>
          <h2 className="text-lg font-medium">Sessions on {agentId}</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowClaude(true)}
            className="px-3 py-1.5 text-sm bg-purple-700 hover:bg-purple-600 rounded transition-colors"
          >
            Claude
          </button>
          <button
            onClick={() => setShowVpn(true)}
            className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
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

      <button
        onClick={handleCreate}
        className="w-full mb-4 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors"
      >
        + New Session
      </button>

      {agentSessions.length === 0 ? (
        <div className="text-slate-400 text-center py-8">
          No active sessions. Create one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {agentSessions.map((session) => (
            <div
              key={session.id}
              className="rounded-xl border bg-slate-800 border-slate-700 p-4"
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
                        className="px-2 py-0.5 bg-slate-700 border border-slate-600 rounded text-sm w-36"
                      />
                      <button
                        type="submit"
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming(null)}
                        className="text-xs text-slate-400 hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <span className="font-medium">{session.name}</span>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    session.status === 'attached'
                      ? 'bg-green-900/40 text-green-400'
                      : session.status === 'detached'
                      ? 'bg-yellow-900/40 text-yellow-400'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {session.status}
                </span>
              </div>

              <div className="text-xs text-slate-400 mb-3">
                Created {timeAgo(session.createdAt)}
              </div>

              <div className="flex gap-2">
                {renaming !== session.id && (
                  <button
                    onClick={() => {
                      setRenaming(session.id);
                      setNewName(session.name);
                    }}
                    className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                  >
                    Rename
                  </button>
                )}
                <button
                  onClick={() => handleConnect(session)}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors"
                >
                  Connect
                </button>
                <button
                  onClick={() => handleKill(session.id)}
                  className="px-3 py-1.5 text-xs bg-red-900/60 hover:bg-red-800 text-red-300 rounded transition-colors"
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
          className="w-full mt-4 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded-lg text-sm transition-colors"
        >
          Kill All Sessions
        </button>
      )}
    </div>
  );
}
