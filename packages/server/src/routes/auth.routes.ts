import { Router } from 'express';
import { generateToken } from '../auth.js';
import { requireAdmin, requireUser } from '../auth-middleware.js';
import * as users from '../users.js';

const router = Router();

// Dependency-free per-key rate limiter for failed login attempts.
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const entry = failedAttempts.get(key);
  if (!entry) return false;
  if (Date.now() >= entry.resetAt) {
    failedAttempts.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failedAttempts.get(key);
  if (!entry || now >= entry.resetAt) {
    failedAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function tokenFor(user: users.User): string {
  return generateToken({ sub: user.id, role: user.role, ver: user.tokenVersion, iat: Date.now() });
}

router.post('/login', (req, res) => {
  // Username defaults to "admin" so the legacy password-only login still works.
  const username = typeof req.body?.username === 'string' && req.body.username.trim()
    ? req.body.username.trim()
    : 'admin';
  const password = req.body?.password;
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const rlKey = `${username}:${ip}`;

  if (isRateLimited(rlKey)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    return;
  }
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'Password required' });
    return;
  }

  const user = users.verifyLogin(username, password);
  if (!user) {
    recordFailure(rlKey);
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  failedAttempts.delete(rlKey);
  res.json({ token: tokenFor(user), user: { id: user.id, username: user.username, role: user.role } });
});

// Current user (from token).
router.get('/me', requireUser, (req: any, res) => {
  const u = users.findById(req.userId);
  if (!u) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({ id: u.id, username: u.username, role: u.role });
});

// Change own password.
router.post('/me/password', requireUser, (req: any, res) => {
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }
  users.setPassword(req.userId, password);
  res.json({ ok: true });
});

// --- Admin: user management ---
router.get('/users', requireAdmin, (_req, res) => {
  res.json(users.listUsers());
});

router.post('/users', requireAdmin, (req: any, res) => {
  const { username, password, role } = req.body || {};
  try {
    const user = users.createUser(username, password, role === 'admin' ? 'admin' : 'user');
    res.json(user);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to create user' });
  }
});

router.post('/users/:id/password', requireAdmin, (req: any, res) => {
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters' });
    return;
  }
  if (!users.findById(req.params.id)) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  users.setPassword(req.params.id, password);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAdmin, (req: any, res) => {
  const target = users.findById(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (target.role === 'admin') {
    res.status(400).json({ error: 'Cannot delete an admin account' });
    return;
  }
  users.deleteUser(req.params.id);
  res.json({ ok: true });
});

export default router;
