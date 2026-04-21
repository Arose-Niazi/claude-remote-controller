export function isNotificationSupported(): boolean {
  return 'Notification' in window;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  return Notification.requestPermission();
}

export function showBrowserNotification(title: string, body: string): void {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

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
