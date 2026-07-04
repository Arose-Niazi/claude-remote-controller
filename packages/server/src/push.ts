import fs from 'fs';
import path from 'path';
import webpush, { type PushSubscription } from 'web-push';

import { config } from './config.js';
import { logger } from './logger.js';

// Persist subscriptions in the data dir so they survive restarts. Single-user
// tool: every subscription (each of the user's devices) receives every push.
const SUBS_FILE = path.join(config.dataDir, 'push-subscriptions.json');

let subscriptions: PushSubscription[] = loadSubscriptions();
let configured = false;

function loadSubscriptions(): PushSubscription[] {
  try {
    const raw = fs.readFileSync(SUBS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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

export function addSubscription(sub: PushSubscription): void {
  if (!sub || !sub.endpoint) return;
  if (!subscriptions.some((s) => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    saveSubscriptions();
    logger.info({ total: subscriptions.length }, 'Push subscription added');
  }
}

export function removeSubscription(endpoint: string): void {
  const before = subscriptions.length;
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
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

/** Fan a notification out to every registered device. Prunes dead endpoints. */
export async function sendPush(payload: PushPayload): Promise<void> {
  if (!configured || subscriptions.length === 0) return;
  const data = JSON.stringify(payload);
  await Promise.all(
    subscriptions.map(async (sub) => {
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
