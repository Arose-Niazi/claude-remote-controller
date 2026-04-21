import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Toast {
  id: number;
  title: string;
  body: string;
  timestamp: number;
}

let toastId = 0;

interface NotificationState {
  enabled: boolean;
  toasts: Toast[];
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  addToast: (title: string, body: string) => void;
  dismissToast: (id: number) => void;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      enabled: false,
      toasts: [],
      setEnabled: (enabled) => set({ enabled }),
      toggle: () => set((s) => ({ enabled: !s.enabled })),
      addToast: (title, body) =>
        set((s) => ({
          toasts: [...s.toasts, { id: ++toastId, title, body, timestamp: Date.now() }],
        })),
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: 'crc-notifications',
      partialize: (state) => ({ enabled: state.enabled }),
    }
  )
);
