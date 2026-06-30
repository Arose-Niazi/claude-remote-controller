import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { generateToken } from '../auth.js';

const router = Router();

// Constant-time comparison; rejects unequal lengths up front.
function safeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// Simple dependency-free in-memory rate limiter for failed login attempts.
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() >= entry.resetAt) {
    failedAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

router.post('/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    return;
  }

  const { password } = req.body;
  if (typeof password !== 'string' || !safeStringEqual(password, config.adminPassword)) {
    recordFailure(ip);
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  // Successful login clears any recorded failures for this IP.
  failedAttempts.delete(ip);
  const token = generateToken({ role: 'admin', iat: Date.now() });
  res.json({ token });
});

export default router;
