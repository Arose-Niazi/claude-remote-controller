import { useEffect, useState } from 'react';
import { apiFetch } from '../api/http';
import type { UserRole } from '../stores/authStore';

interface UsersManagerProps {
  onClose: () => void;
}

interface ManagedUser {
  id: string;
  username: string;
  role: UserRole;
  tokenVersion: number;
  createdAt: number;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return data.error;
  } catch {
    // ignore non-JSON body
  }
  return fallback;
}

export default function UsersManager({ onClose }: UsersManagerProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [creating, setCreating] = useState(false);

  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  async function loadUsers() {
    setError(null);
    try {
      const res = await apiFetch('/api/auth/users');
      if (!res.ok) {
        setError(await readError(res, 'Failed to load users'));
        return;
      }
      setUsers(await res.json());
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreate() {
    const username = newUsername.trim();
    if (!username || !newPassword) return;
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({ username, password: newPassword, role: newRole }),
      });
      if (!res.ok) {
        setError(await readError(res, 'Failed to create user'));
        return;
      }
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setAdding(false);
      loadUsers();
    } catch {
      setError('Connection failed');
    } finally {
      setCreating(false);
    }
  }

  async function handleResetPassword(id: string) {
    if (!resetPassword) return;
    setResetting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/auth/users/${id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password: resetPassword }),
      });
      if (!res.ok) {
        setError(await readError(res, 'Failed to reset password'));
        return;
      }
      setResetId(null);
      setResetPassword('');
    } catch {
      setError('Connection failed');
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete(user: ManagedUser) {
    if (user.role === 'admin') return;
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/auth/users/${user.id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(await readError(res, 'Failed to delete user'));
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch {
      setError('Connection failed');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider">Users</h3>
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

          {adding ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreate();
              }}
              className="bg-surface-deep rounded-xl border border-border-subtle p-3 space-y-2"
            >
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Username"
                autoFocus
                autoComplete="off"
                className="w-full px-3 py-2 bg-surface-raised border border-border rounded-lg text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Password"
                autoComplete="new-password"
                className="w-full px-3 py-2 bg-surface-raised border border-border rounded-lg text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
                className="w-full px-3 py-2 bg-surface-raised border border-border rounded-lg text-sm text-text focus:outline-none focus:border-accent transition-colors"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creating || !newUsername.trim() || !newPassword}
                  className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {creating ? 'Creating...' : 'Create user'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setNewUsername('');
                    setNewPassword('');
                    setNewRole('user');
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
              + Add user
            </button>
          )}

          {loading ? (
            <div className="text-center text-text-muted text-sm py-6">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="text-center text-text-muted text-sm py-6">No users found.</div>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="bg-surface-deep rounded-xl border border-border-subtle p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-text truncate">{user.username}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${
                          user.role === 'admin'
                            ? 'bg-accent/15 text-accent'
                            : 'bg-surface-overlay text-text-secondary'
                        }`}
                      >
                        {user.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => {
                          setResetId(resetId === user.id ? null : user.id);
                          setResetPassword('');
                        }}
                        className="text-[10px] px-2 py-1 bg-surface-raised hover:bg-surface-overlay border border-border text-text-secondary rounded-lg transition-colors"
                      >
                        Reset
                      </button>
                      {user.role !== 'admin' && (
                        <button
                          onClick={() => handleDelete(user)}
                          className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          title="Delete user"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {resetId === user.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleResetPassword(user.id);
                      }}
                      className="flex gap-2 mt-2.5"
                    >
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        placeholder="New password"
                        autoFocus
                        autoComplete="new-password"
                        className="flex-1 px-3 py-1.5 bg-surface-raised border border-border rounded-lg text-sm text-text placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={resetting || !resetPassword}
                        className="px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        {resetting ? '...' : 'Save'}
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
