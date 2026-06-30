import { createHmac, timingSafeEqual } from 'crypto';
import { config } from './config.js';

const DEFAULT_TOKEN_TTL_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function tokenTtlMs(): number {
  const days = parseInt(process.env.TOKEN_TTL_DAYS || '', 10);
  const ttlDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_TOKEN_TTL_DAYS;
  return ttlDays * MS_PER_DAY;
}

// Constant-time comparison of two strings; rejects unequal lengths up front.
function safeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function generateToken(payload: Record<string, unknown>): string {
  const now = Date.now();
  const body = { ...payload, exp: now + tokenTtlMs() };
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', config.tokenSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expectedSig = createHmac('sha256', config.tokenSecret).update(data).digest('base64url');
  if (!safeStringEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as Record<string, unknown>;
    const exp = payload.exp;
    if (typeof exp === 'number' && Date.now() >= exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function validateAgentAuth(agentId: string, secret: string): boolean {
  const expected = config.agents[agentId];
  if (typeof expected !== 'string') return false;
  return safeStringEqual(expected, secret);
}
