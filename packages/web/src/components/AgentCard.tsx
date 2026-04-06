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
  const platformIcon = agent.platform === 'win32' ? '\u{1F5A5}' : '\u{1F4BB}';

  return (
    <div
      className={`rounded-2xl border p-4 transition-all ${
        isOnline
          ? 'bg-surface-raised border-border hover:border-accent/40'
          : 'bg-surface border-border/50 opacity-50'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{platformIcon}</span>
          <span className="font-medium text-sm">{agent.name}</span>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
            isOnline
              ? 'bg-green-500/15 text-green-400'
              : 'bg-surface-overlay text-text-muted'
          }`}
        >
          {isOnline ? 'online' : 'offline'}
        </span>
      </div>

      <div className="text-xs text-text-secondary space-y-1.5 mb-4">
        <div className="truncate">{agent.homeDirectory || agent.hostname}</div>
        {isOnline && (
          <div className="flex gap-3">
            <span>CPU {agent.cpuUsage}%</span>
            <span>MEM {agent.memoryUsage}%</span>
            <span>{formatUptime(agent.uptime)}</span>
          </div>
        )}
      </div>

      <button
        onClick={() => navigate(`/sessions/${agent.id}`)}
        disabled={!isOnline}
        className="w-full py-2 bg-accent hover:bg-accent-hover disabled:bg-surface-overlay disabled:text-text-muted disabled:cursor-not-allowed rounded-xl text-sm font-medium transition-all text-white"
      >
        Connect
      </button>
    </div>
  );
}
