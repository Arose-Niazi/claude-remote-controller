import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { isNotificationSupported, requestPermission } from '../lib/notify';
import { subscribeToPush, unsubscribeFromPush } from '../lib/push';
import Toasts from './Toasts';

interface LayoutProps {
  children: ReactNode;
  connected: boolean;
}

export default function Layout({ children, connected }: LayoutProps) {
  const logout = useAuthStore((s) => s.logout);
  const token = useAuthStore((s) => s.token);
  const notifyEnabled = useNotificationStore((s) => s.enabled);
  const setNotifyEnabled = useNotificationStore((s) => s.setEnabled);

  const handleToggleNotifications = async () => {
    if (notifyEnabled) {
      setNotifyEnabled(false);
      if (token) unsubscribeFromPush(token).catch(() => {});
      return;
    }

    // Turning notifications on. In-app toasts always work; OS + push
    // notifications additionally require the browser permission.
    let granted = isNotificationSupported() && Notification.permission === 'granted';
    if (isNotificationSupported() && Notification.permission === 'default') {
      granted = (await requestPermission()) === 'granted';
    }
    setNotifyEnabled(true);
    // Register for real Web Push so alerts arrive even when the app is closed.
    if (granted && token) subscribeToPush(token).catch(() => {});
  };

  // OS-level notifications are only actually delivered when the browser
  // permission is granted; otherwise we fall back to in-app toasts only.
  const osBlocked =
    notifyEnabled && (!isNotificationSupported() || Notification.permission !== 'granted');

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
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggleNotifications}
            className={`p-1.5 rounded-lg transition-colors ${
              !notifyEnabled
                ? 'text-text-muted hover:text-text-secondary'
                : osBlocked
                ? 'text-amber-400 bg-amber-500/10'
                : 'text-accent bg-accent/10'
            }`}
            title={
              !notifyEnabled
                ? 'Notifications off'
                : osBlocked
                ? 'In-app alerts on — OS notifications blocked (allow them in your browser settings)'
                : 'Notifications on'
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {notifyEnabled ? (
                <>
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </>
              ) : (
                <>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
                  <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
                  <path d="M18 8a6 6 0 0 0-9.33-5" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              )}
            </svg>
          </button>
          <button
            onClick={logout}
            className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text bg-surface-raised hover:bg-surface-overlay border border-border rounded-lg transition-all"
          >
            Logout
          </button>
        </div>
      </header>
      <Toasts />
      <main>{children}</main>
    </div>
  );
}
