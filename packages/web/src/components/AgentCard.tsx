import type { AgentInfo } from '@crc/shared';
import { useNavigate } from 'react-router-dom';

interface AgentCardProps {
  agent: AgentInfo;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function AgentCard({ agent }: AgentCardProps) {
  const navigate = useNavigate();
  const isOnline = agent.status === 'online';
  const platformLabel = agent.platform === 'win32' ? 'Windows' : 'macOS';

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isOnline
          ? 'bg-slate-800 border-slate-700 hover:border-slate-500'
          : 'bg-slate-800/50 border-slate-700/50 opacity-60'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isOnline ? 'bg-green-400' : 'bg-slate-500'
            }`}
          />
          <span className="font-medium">{agent.name}</span>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            isOnline
              ? 'bg-green-900/40 text-green-400'
              : 'bg-slate-700 text-slate-400'
          }`}
        >
          {isOnline ? 'online' : 'offline'}
        </span>
      </div>

      <div className="text-sm text-slate-400 space-y-1 mb-4">
        <div>{platformLabel} | {agent.homeDirectory || agent.hostname}</div>
        {isOnline && (
          <>
            <div>
              CPU: {agent.cpuUsage}% &nbsp; MEM: {agent.memoryUsage}%
            </div>
            <div>Uptime: {formatUptime(agent.uptime)}</div>
          </>
        )}
      </div>

      <button
        onClick={() => navigate(`/terminal/${agent.id}`)}
        disabled={!isOnline}
        className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
      >
        Connect
      </button>
    </div>
  );
}
