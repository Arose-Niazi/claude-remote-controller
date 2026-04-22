// ── Service Worker registration ─────────────────────────────────────
// ServiceWorkerRegistration.showNotification() works in background tabs
// on mobile — unlike `new Notification()` which browsers block.

let swRegistration: ServiceWorkerRegistration | null = null;

export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      swRegistration = reg;
    }).catch(() => { /* SW not available */ });
  }
}

// ── Permission ──────────────────────────────────────────────────────

export function isNotificationSupported(): boolean {
  return 'Notification' in window;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  return Notification.requestPermission();
}

// ── Browser notification ────────────────────────────────────────────

export function showBrowserNotification(title: string, body: string): void {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  // Prefer service worker notification (works in background on mobile)
  if (swRegistration) {
    swRegistration.showNotification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'crc-' + Date.now(),
    }).catch(() => { /* fallback below */ });
    return;
  }

  // Fallback: regular Notification (foreground only on mobile)
  const n = new Notification(title, {
    body,
    icon: '/favicon.ico',
    tag: 'crc-' + Date.now(),
  });

  n.onclick = () => {
    window.focus();
    n.close();
  };

  setTimeout(() => n.close(), 15_000);
}

// ── Sound ───────────────────────────────────────────────────────────

export function playSound(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {
    // Audio not available
  }
}

// ── Title flash ─────────────────────────────────────────────────────

let titleFlashTimer: number | null = null;
const originalTitle = document.title;

export function flashTitle(message: string): void {
  if (document.hasFocus()) return;

  if (titleFlashTimer) clearInterval(titleFlashTimer);

  let show = true;
  titleFlashTimer = window.setInterval(() => {
    document.title = show ? message : originalTitle;
    show = !show;
  }, 1000);

  const stop = () => {
    if (titleFlashTimer) {
      clearInterval(titleFlashTimer);
      titleFlashTimer = null;
    }
    document.title = originalTitle;
    document.removeEventListener('visibilitychange', stop);
    window.removeEventListener('focus', stop);
  };
  document.addEventListener('visibilitychange', stop);
  window.addEventListener('focus', stop);
}
