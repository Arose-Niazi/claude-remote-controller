import { Router } from 'express';
import { requireUser } from '../auth-middleware.js';
import { addSubscription, removeSubscription, getVapidPublicKey, isPushConfigured } from '../push.js';

const router = Router();

// Public: the browser needs the VAPID public key to create a subscription.
router.get('/vapid', (_req, res) => {
  res.json({ publicKey: getVapidPublicKey(), enabled: isPushConfigured() });
});

router.post('/subscribe', requireUser, (req: any, res) => {
  const sub = req.body?.subscription || req.body;
  if (!sub?.endpoint) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }
  addSubscription(req.userId, sub);
  res.json({ ok: true });
});

router.post('/unsubscribe', requireUser, (req, res) => {
  const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
  if (endpoint) removeSubscription(endpoint);
  res.json({ ok: true });
});

export default router;
