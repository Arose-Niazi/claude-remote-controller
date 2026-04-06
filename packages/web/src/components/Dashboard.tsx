import type { Socket } from 'socket.io-client';
import { useAgentStore } from '../stores/agentStore';
import AgentCard from './AgentCard';

interface DashboardProps {
  socket: Socket | null;
}

export default function Dashboard({ socket: _socket }: DashboardProps) {
  const agents = useAgentStore((s) => s.agents);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-4">Your Machines</h2>
      {agents.length === 0 ? (
        <div className="text-text-muted text-center py-16 bg-surface rounded-2xl border border-border">
          <div className="text-3xl mb-3 opacity-40">&#9679;</div>
          <p className="text-sm">No agents connected</p>
          <p className="text-xs text-text-muted mt-1">Start an agent on your PC to see it here</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
