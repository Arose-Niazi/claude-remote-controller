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
      <h2 className="text-lg font-medium mb-4">Agents</h2>
      {agents.length === 0 ? (
        <div className="text-slate-400 text-center py-12">
          No agents connected. Start an agent on your PC to see it here.
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
