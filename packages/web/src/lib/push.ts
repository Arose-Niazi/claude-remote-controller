// Web Push subscription management. Subscribes the browser to the CRC server's
// VAPID push so notifications arrive even when the app is closed / phone locked.

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

/**
 * Subscribe this device to Web Push and register the subscription with the
 * server. Safe to call repeatedly (idempotent). Returns true on success.
 */
export async function subscribeToPush(token: string): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await getRegistration();
  if (!reg) return false;

  let publicKey = '';
  try {
    const res = await fetch('/api/push/vapid');
    const json = await res.json();
    if (!json.enabled || !json.publicKey) return false;
    publicKey = json.publicKey;
  } catch {
    return false;
  }

  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(sub),
    });
    return true;
  } catch {
    return false;
  }
}

/** Remove this device's push subscription from the server and the browser. */
export async function unsubscribeFromPush(token: string): Promise<void> {
  const reg = await getRegistration();
  if (!reg) return;
  try {
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  } catch {
    /* ignore */
  }
}
