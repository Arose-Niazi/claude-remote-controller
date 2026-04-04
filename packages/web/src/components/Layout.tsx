import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';

interface LayoutProps {
  children: ReactNode;
  connected: boolean;
}

export default function Layout({ children, connected }: LayoutProps) {
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Remote Controller</h1>
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? 'bg-green-400' : 'bg-red-400'
            }`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        </div>
        <button
          onClick={logout}
          className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          Logout
        </button>
      </header>
      <main>{children}</main>
    </div>
  );
}
