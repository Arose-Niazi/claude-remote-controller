import { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';

interface AgentsManagerProps {
  onClose: () => void;
}

interface EnrolledAgent {
  agentId: string;
  name: string;
  createdAt: number;
  online: boolean;
}

interface NewAgent {
  agentId: string;
  secret: string;
  name: string;
}

// Encode a UTF-8 string as base64url (btoa only handles latin1, so encode
// unicode via encodeURIComponent first, then strip padding and swap chars).
function base64UrlEncode(input: string): string {
  const b64 = btoa(
    encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16))
    )
  );
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildEnrollToken(agentId: string, secret: string): string {
  const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;
  return base64UrlEncode(JSON.stringify({ v: 1, serverUrl: wsUrl, agentId, secret }));
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard unavailable; ignore
        }
      }}
      className="flex-shrink-0 text-[10px] px-2 py-1 bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function AgentsManager({ onClose }: AgentsManagerProps) {
  const [agents, setAgents] = useState<EnrolledAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<NewAgent | null>(null);

  async function loadAgents() {
    setError(null);
    try {
      const res = await apiFetch('/api/agents/enrolled');
      if (!res.ok) {
        setError('Failed to load agents');
        return;
      }
      setAgents(await res.json());
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
  }, []);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/agents/enroll', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        let msg = 'Failed to create agent';
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch {
          // ignore
        }
        setError(msg);
        return;
      }
      const agent: NewAgent = await res.json();
      setCreated(agent);
      setNewName('');
      setAdding(false);
      loadAgents();
    } catch {
      setError('Connection failed');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(agentId: string) {
    if (!confirm('Remove this agent? It will need to be re-enrolled to reconnect.')) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/agents/${agentId}`, { method: 'DELETE' });
      if (!res.ok) {
        setError('Failed to remove agent');
        return;
      }
      setAgents((prev) => prev.filter((a) => a.agentId !== agentId));
    } catch {
      setError('Connection failed');
    }
  }

  const enrollToken = created ? buildEnrollToken(created.agentId, created.secret) : '';
  const installCmd = `npm i -g cli-remote-agent && crc-agent setup --token ${enrollToken}`;
  const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider">Agents</h3>
          <button
            onClick={onClose}
            className="text-xs px-2.5 py-1 bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded-lg p-2 break-words">
              {error}
            </div>
          )}

          {/* Freshly enrolled agent: show one-time install snippet */}
          {created && (
            <div className="bg-surface-deep rounded-xl border border-accent/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text">{created.name}</span>
                <button
                  onClick={() => setCreated(null)}
                  className="text-[10px] px-2 py-1 bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
                >
                  Done
                </button>
              </div>
              <p className="text-xs text-amber-400">
                Run this on the machine to enroll it. The secret is shown only once.
              </p>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Install command</div>
                <div className="flex items-start gap-2">
                  <code className="flex-1 text-[11px] text-accent bg-surface-raised rounded-lg p-2 break-all">
                    {installCmd}
                  </code>
                  <CopyButton value={installCmd} />
                </div>
              </div>
              <div className="space-y-1.5 pt-1 border-t border-border-subtle">
                <div className="text-[10px] uppercase tracking-wider text-text-muted">Manual setup (fallback)</div>
                {([
                  ['Server URL', wsUrl],
                  ['Agent ID', created.agentId],
                  ['Secret', created.secret],
                ] as const).map(([label, value]) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="w-20 flex-shrink-0 text-[10px] text-text-muted">{label}</span>
                    <code className="flex-1 text-[11px] text-text bg-surface-raised rounded-lg px-2 py-1 break-all">
                      {value}
                    </code>
                    <CopyButton value={value} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add-agent form */}
          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreate();
              }}
              className="bg-surface-deep rounded-xl border border-border-subtle p-3 space-y-2"
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Agent name (e.g. my-laptop)"
                autoFocus
                className="w-full px-3 py-2 bg-surface-raised border border-border rounded-lg text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setNewName('');
                  }}
                  className="px-3 py-2 bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-medium transition-colors"
            >
              + Add agent
            </button>
          )}

          {/* Enrolled agents list */}
          {loading ? (
            <div className="text-center text-text-muted text-sm py-6">Loading agents...</div>
          ) : agents.length === 0 ? (
            <div className="text-center text-text-muted text-sm py-6">
              No agents enrolled yet.
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map((agent) => (
                <div
                  key={agent.agentId}
                  className="flex items-center justify-between bg-surface-deep rounded-xl border border-border-subtle p-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                        agent.online ? 'bg-green-500' : 'bg-text-muted/40'
                      }`}
                      title={agent.online ? 'Online' : 'Offline'}
                    />
                    <span className="text-sm font-medium text-text truncate">{agent.name}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(agent.agentId)}
                    className="flex-shrink-0 p-1.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Remove agent"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
