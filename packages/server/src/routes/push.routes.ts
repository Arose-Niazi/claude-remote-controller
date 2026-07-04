import { Router } from 'express';
import { verifyToken } from '../auth.js';
import { addSubscription, removeSubscription, getVapidPublicKey, isPushConfigured } from '../push.js';

const router = Router();

// Public: the browser needs the VAPID public key to create a subscription.
router.get('/vapid', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey(), enabled: isPushConfigured() });
});

// Bearer-token auth for (un)subscribe.
function requireAuth(req: any, res: any, next: any): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ') || !verifyToken(auth.slice(7))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

router.post('/subscribe', requireAuth, (req, res) => {
  const sub = req.body?.subscription || req.body;
  if (!sub?.endpoint) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }
  addSubscription(sub);
  res.json({ ok: true });
});

router.post('/unsubscribe', requireAuth, (req, res) => {
  const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
  if (endpoint) removeSubscription(endpoint);
  res.json({ ok: true });
});

export default router;
