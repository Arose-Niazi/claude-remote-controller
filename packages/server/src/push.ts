import fs from 'fs';
import path from 'path';
import webpush, { type PushSubscription } from 'web-push';

import { config } from './config.js';
import { logger } from './logger.js';

// Persist subscriptions in the data dir so they survive restarts. Each entry is
// scoped to the user that registered it so pushes only reach that user's devices.
const SUBS_FILE = path.join(config.dataDir, 'push-subscriptions.json');

interface StoredSubscription {
  userId: string;
  sub: PushSubscription;
}

let subscriptions: StoredSubscription[] = loadSubscriptions();
let configured = false;

function loadSubscriptions(): StoredSubscription[] {
  try {
    const raw = fs.readFileSync(SUBS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Only accept the new per-user shape. An old flat PushSubscription[] (no
    // userId) is ignored — devices re-register on next app open.
    return parsed.filter(
      (e): e is StoredSubscription =>
        e && typeof e.userId === 'string' && e.sub && typeof e.sub.endpoint === 'string'
    );
  } catch {
    return [];
  }
}

function saveSubscriptions(): void {
  try {
    fs.mkdirSync(path.dirname(SUBS_FILE), { recursive: true });
    fs.writeFileSync(SUBS_FILE, JSON.stringify(subscriptions), 'utf-8');
  } catch (err) {
    logger.warn({ err }, 'Failed to persist push subscriptions');
  }
}

export function initPush(): void {
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    configured = true;
    logger.info({ subscriptions: subscriptions.length }, 'Web Push enabled');
  } else {
    logger.warn('Web Push disabled — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable');
  }
}

export function isPushConfigured(): boolean {
  return configured;
}

export function getVapidPublicKey(): string {
  return config.vapidPublicKey;
}

export function addSubscription(userId: string, sub: PushSubscription): void {
  if (!userId || !sub || !sub.endpoint) return;
  // Upsert by endpoint: replace an existing registration (e.g. re-owned device)
  // or append a new one.
  const existing = subscriptions.find((s) => s.sub.endpoint === sub.endpoint);
  if (existing) {
    existing.userId = userId;
    existing.sub = sub;
  } else {
    subscriptions.push({ userId, sub });
  }
  saveSubscriptions();
  logger.info({ total: subscriptions.length }, 'Push subscription added');
}

export function removeSubscription(endpoint: string): void {
  const before = subscriptions.length;
  subscriptions = subscriptions.filter((s) => s.sub.endpoint !== endpoint);
  if (subscriptions.length !== before) {
    saveSubscriptions();
    logger.info({ total: subscriptions.length }, 'Push subscription removed');
  }
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  agentId?: string;
  url?: string;
}

/** Fan a notification out to every device owned by `userId`. Prunes dead endpoints. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!configured) return;
  const targets = subscriptions.filter((s) => s.userId === userId);
  if (targets.length === 0) return;
  const data = JSON.stringify(payload);
  await Promise.all(
    targets.map(async ({ sub }) => {
      try {
        await webpush.sendNotification(sub, data);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the subscription is gone — drop it.
        if (status === 404 || status === 410) {
          removeSubscription(sub.endpoint);
        } else {
          logger.warn({ status }, 'Push send failed');
        }
      }
    })
  );
}
