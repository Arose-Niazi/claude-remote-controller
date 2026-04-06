import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';

export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Login failed');
        return;
      }

      const { token } = await res.json();
      login(token);
    } catch {
      setError('Connection failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-deep flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-surface rounded-2xl p-8 shadow-2xl border border-border"
      >
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-accent">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        </div>
        <h1 className="text-xl font-semibold text-center mb-1">Claude Remote</h1>
        <p className="text-sm text-text-secondary text-center mb-6">Sign in to your machines</p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full px-4 py-3 bg-surface-raised border border-border rounded-xl text-text placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 mb-4 transition-colors"
        />

        <button
          type="submit"
          disabled={loading || !password}
          className="w-full py-3 bg-accent hover:bg-accent-hover disabled:bg-surface-raised disabled:text-text-muted disabled:cursor-not-allowed rounded-xl font-medium transition-all text-white"
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
