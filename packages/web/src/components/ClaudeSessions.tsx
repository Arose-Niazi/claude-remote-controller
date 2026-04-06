import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { CLAUDE_SESSIONS_LIST, CLAUDE_SESSIONS_RESULT } from '@crc/shared';
import type { ClaudeSessionInfo, ClaudeSessionsResultPayload } from '@crc/shared';

interface ClaudeSessionsProps {
  socket: Socket | null;
  agentId: string;
  onClose: () => void;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shortModel(model?: string): string {
  if (!model) return '';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model;
}

function projectName(fullPath: string): string {
  const parts = fullPath.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

export default function ClaudeSessions({ socket, agentId, onClose }: ClaudeSessionsProps) {
  const [sessions, setSessions] = useState<ClaudeSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!socket) return;
    socket.emit(CLAUDE_SESSIONS_LIST, { agentId });

    const handleResult = (payload: ClaudeSessionsResultPayload) => {
      if (payload.agentId === agentId) {
        setSessions(payload.sessions);
        setLoading(false);
      }
    };

    socket.on(CLAUDE_SESSIONS_RESULT, handleResult);
    return () => {
      socket.off(CLAUDE_SESSIONS_RESULT, handleResult);
    };
  }, [socket, agentId]);

  function handleResume(session: ClaudeSessionInfo) {
    const cmd = `cd ${JSON.stringify(session.projectPath)} && claude --resume ${session.sessionId}`;
    navigate(`/terminal/${agentId}/new?cmd=${encodeURIComponent(cmd)}`);
  }

  function handleNewClaude(projectPath: string) {
    const cmd = `cd ${JSON.stringify(projectPath)} && claude`;
    navigate(`/terminal/${agentId}/new?cmd=${encodeURIComponent(cmd)}`);
  }

  // Group sessions by project
  const grouped = new Map<string, ClaudeSessionInfo[]>();
  for (const s of sessions) {
    const key = s.projectPath;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  }

  const filteredProjects = [...grouped.entries()].filter(
    ([path, items]) =>
      !filter ||
      path.toLowerCase().includes(filter.toLowerCase()) ||
      items.some((s) => s.firstMessage.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <h3 className="text-sm font-semibold">Claude Sessions</h3>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded"
          >
            Close
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-slate-700 flex-shrink-0">
          <input
            type="text"
            placeholder="Filter projects or messages..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-600 rounded focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading && (
            <div className="text-center text-slate-400 text-sm py-8">
              Scanning Claude sessions...
            </div>
          )}

          {!loading && sessions.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-8">
              No Claude sessions found.
              <br />
              <span className="text-xs text-slate-500">
                Run claude in a project directory first.
              </span>
            </div>
          )}

          {filteredProjects.map(([path, items]) => (
            <div key={path} className="rounded-lg border border-slate-700 bg-slate-900/50 overflow-hidden">
              {/* Project header */}
              <div className="flex items-center justify-between px-3 py-2 bg-slate-800/50">
                <span className="text-xs font-medium text-blue-400 truncate">{projectName(path)}</span>
                <button
                  onClick={() => handleNewClaude(path)}
                  className="text-xs px-2 py-0.5 bg-green-700 hover:bg-green-600 text-white rounded flex-shrink-0 ml-2"
                >
                  New
                </button>
              </div>

              {/* Sessions */}
              <div className="divide-y divide-slate-700/50">
                {items.map((s) => (
                  <div key={s.sessionId} className="px-3 py-2 hover:bg-slate-800/30">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-slate-300 line-clamp-2 flex-1">
                        {s.firstMessage}
                      </p>
                      <button
                        onClick={() => handleResume(s)}
                        className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white rounded flex-shrink-0"
                      >
                        Resume
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      <span>{timeAgo(s.lastTimestamp)}</span>
                      {s.model && <span>{shortModel(s.model)}</span>}
                      <span>{s.messageCount} msgs</span>
                      {s.gitBranch && <span>{s.gitBranch}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
