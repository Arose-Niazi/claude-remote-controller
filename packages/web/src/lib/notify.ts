// ── Service Worker registration ─────────────────────────────────────
// ServiceWorkerRegistration.showNotification() works in background tabs
// on mobile — unlike `new Notification()` which browsers block.

let swRegistration: ServiceWorkerRegistration | null = null;

export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(() => {
      // Wait until the SW is actually active before relying on it for
      // notifications — register() resolves before activation, and
      // showNotification() on an inactive registration rejects.
      return navigator.serviceWorker.ready;
    }).then((reg) => {
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

// A stable tag so successive alerts coalesce (a new notification replaces the
// previous one of the same category) instead of stacking up.
const NOTIFICATION_TAG = 'crc-notification';

function showFallbackNotification(title: string, body: string): void {
  // Fallback: regular Notification (foreground only on mobile)
  const n = new Notification(title, {
    body,
    icon: '/icon-192.png',
    tag: NOTIFICATION_TAG,
  });

  n.onclick = () => {
    window.focus();
    n.close();
  };

  setTimeout(() => n.close(), 15_000);
}

export function showBrowserNotification(title: string, body: string): void {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  // Prefer service worker notification (works in background on mobile).
  // If it rejects (inactive SW, etc.), fall back to a regular Notification.
  if (swRegistration && swRegistration.active) {
    swRegistration
      .showNotification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: NOTIFICATION_TAG,
      })
      .then(() => {
        // SW notifications don't auto-close; close any of ours after a delay so
        // they don't linger indefinitely.
        setTimeout(() => {
          swRegistration
            ?.getNotifications({ tag: NOTIFICATION_TAG })
            .then((ns) => ns.forEach((n) => n.close()))
            .catch(() => { /* ignore */ });
        }, 15_000);
      })
      .catch(() => {
        try {
          showFallbackNotification(title, body);
        } catch { /* notification unavailable */ }
      });
    return;
  }

  showFallbackNotification(title, body);
}

// ── Cross-source Claude-event dedup ─────────────────────────────────
// Claude completion can be reported by BOTH the in-terminal working-line
// detector AND the server's hook-driven CLAUDE_NOTIFY broadcast. This coalesces
// them by kind ('done' / 'input') so only the first within the window notifies.
let lastClaudeKey = '';
let lastClaudeAt = 0;

export function claudeDedup(kind: string, windowMs = 8000): boolean {
  const now = Date.now();
  if (kind === lastClaudeKey && now - lastClaudeAt < windowMs) return false;
  lastClaudeKey = kind;
  lastClaudeAt = now;
  return true;
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
// Teardown for the listeners/timer registered by the most recent flashTitle
// call. Invoked at the start of the next call so we never leak a growing pile
// of visibilitychange/focus listeners.
let stopTitleFlash: (() => void) | null = null;

export function flashTitle(message: string): void {
  if (document.hasFocus()) return;

  // Tear down any previous flash (timer + listeners) before starting a new one.
  if (stopTitleFlash) stopTitleFlash();

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
    stopTitleFlash = null;
  };
  stopTitleFlash = stop;
  document.addEventListener('visibilitychange', stop);
  window.addEventListener('focus', stop);
}
