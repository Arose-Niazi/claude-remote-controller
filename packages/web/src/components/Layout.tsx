import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

interface LayoutProps {
  children: ReactNode;
  connected: boolean;
}

export default function Layout({ children, connected }: LayoutProps) {
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="min-h-screen bg-surface-deep text-text">
      <header className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-accent">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm0-4h2V7h-2v6z" fill="currentColor" opacity="0.8"/>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            </svg>
            <h1 className="text-base font-semibold tracking-tight">Claude Remote</h1>
          </div>
          <span
            className={`inline-block w-2 h-2 rounded-full transition-colors ${
              connected ? 'bg-green-500' : 'bg-red-500'
            }`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        </div>
        <button
          onClick={logout}
          className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text bg-surface-raised hover:bg-surface-overlay border border-border rounded-lg transition-all"
        >
          Logout
        </button>
      </header>
      <main>{children}</main>
    </div>
  );
}
