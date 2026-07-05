import { useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useAgentStore } from '../stores/agentStore';
import { useAuthStore } from '../stores/authStore';
import AgentCard from './AgentCard';
import AgentsManager from './AgentsManager';
import UsersManager from './UsersManager';

interface DashboardProps {
  socket: Socket | null;
}

export default function Dashboard({ socket: _socket }: DashboardProps) {
  const agents = useAgentStore((s) => s.agents);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const [showAgents, setShowAgents] = useState(false);
  const [showUsers, setShowUsers] = useState(false);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">Your Machines</h2>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowUsers(true)}
              className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text bg-surface-raised hover:bg-surface-overlay border border-border rounded-lg transition-all"
            >
              Users
            </button>
          )}
          <button
            onClick={() => setShowAgents(true)}
            className="px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-lg transition-all"
          >
            + Add agent
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="text-text-muted text-center py-16 bg-surface rounded-2xl border border-border">
          <div className="text-3xl mb-3 opacity-40">&#9679;</div>
          <p className="text-sm">No agents connected</p>
          <p className="text-xs text-text-muted mt-1">Add an agent and start it on your PC to see it here</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {showAgents && <AgentsManager onClose={() => setShowAgents(false)} />}
      {showUsers && isAdmin && <UsersManager onClose={() => setShowUsers(false)} />}
    </div>
  );
}
