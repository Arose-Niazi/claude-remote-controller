import { verifyToken } from './auth.js';
import { resolveTokenUser, type Role } from './users.js';

export interface AuthedRequest {
  userId?: string;
  role?: Role;
}

/** Resolve the authenticated user from a Bearer token, or null. */
export function authenticate(req: any): { userId: string; role: Role } | null {
  const auth = req.headers?.authorization;
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) return null;
  const payload = verifyToken(auth.slice(7));
  if (!payload) return null;
  return resolveTokenUser(payload);
}

/** Express middleware: require any authenticated user. Attaches req.userId/role. */
export function requireUser(req: any, res: any, next: any): void {
  const u = authenticate(req);
  if (!u) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.userId = u.userId;
  req.role = u.role;
  next();
}

/** Express middleware: require an admin. */
export function requireAdmin(req: any, res: any, next: any): void {
  const u = authenticate(req);
  if (!u) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (u.role !== 'admin') {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  req.userId = u.userId;
  req.role = u.role;
  next();
}
