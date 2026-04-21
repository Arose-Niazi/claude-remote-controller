import { useEffect } from 'react';
import { useNotificationStore } from '../stores/notificationStore';

export default function Toasts() {
  const toasts = useNotificationStore((s) => s.toasts);
  const dismissToast = useNotificationStore((s) => s.dismissToast);

  // Auto-dismiss oldest toast after 8 seconds
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[0];
    const age = Date.now() - oldest.timestamp;
    const delay = Math.max(8000 - age, 0);
    const timer = setTimeout(() => dismissToast(oldest.id), delay);
    return () => clearTimeout(timer);
  }, [toasts, dismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 right-3 z-50 flex flex-col gap-2 max-w-xs">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="bg-surface-raised border border-accent/30 rounded-2xl p-3 shadow-xl animate-toast-in"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium text-text">{toast.title}</div>
              <div className="text-xs text-text-muted mt-0.5 truncate">{toast.body}</div>
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors flex-shrink-0 mt-0.5"
            >
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
