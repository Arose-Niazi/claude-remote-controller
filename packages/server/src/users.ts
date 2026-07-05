import { randomUUID } from 'crypto';
import { loadJson, saveJson } from './store.js';
import { hashSecret, verifySecret } from './hash.js';
import { logger } from './logger.js';

export type Role = 'admin' | 'user';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  tokenVersion: number; // bumped to revoke existing tokens
  createdAt: number;
}

export type PublicUser = Omit<User, 'passwordHash'>;

const FILE = 'users.json';
let users: User[] = loadJson<User[]>(FILE, []);

function persist(): void {
  saveJson(FILE, users);
}

function toPublic(u: User): PublicUser {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

export function userCount(): number {
  return users.length;
}

export function findById(id: string): User | undefined {
  return users.find((u) => u.id === id);
}

export function findByUsername(username: string): User | undefined {
  const lower = username.toLowerCase();
  return users.find((u) => u.username.toLowerCase() === lower);
}

export function getAdmin(): User | undefined {
  return users.find((u) => u.role === 'admin');
}

export function listUsers(): PublicUser[] {
  return users.map(toPublic);
}

export function createUser(username: string, password: string, role: Role = 'user'): PublicUser {
  const name = username.trim();
  if (!/^[A-Za-z0-9_.-]{2,32}$/.test(name)) {
    throw new Error('Username must be 2-32 chars: letters, numbers, . _ -');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  if (findByUsername(name)) {
    throw new Error('Username already exists');
  }
  const user: User = {
    id: randomUUID(),
    username: name,
    passwordHash: hashSecret(password),
    role,
    tokenVersion: 0,
    createdAt: Date.now(),
  };
  users.push(user);
  persist();
  logger.info({ username: name, role }, 'User created');
  return toPublic(user);
}

export function verifyLogin(username: string, password: string): User | null {
  const user = findByUsername(username);
  if (!user) return null;
  return verifySecret(password, user.passwordHash) ? user : null;
}

export function setPassword(id: string, password: string): void {
  const u = findById(id);
  if (!u) return;
  u.passwordHash = hashSecret(password);
  u.tokenVersion += 1; // invalidate existing tokens
  persist();
}

export function deleteUser(id: string): void {
  users = users.filter((u) => u.id !== id);
  persist();
}

/**
 * Resolve a verified token payload to a live user, enforcing token revocation
 * (tokenVersion) and mapping legacy sub-less admin tokens to the seeded admin
 * during the upgrade deprecation window.
 */
export function resolveTokenUser(payload: Record<string, unknown>): { userId: string; role: Role } | null {
  if (typeof payload.sub === 'string') {
    const u = findById(payload.sub);
    if (!u) return null;
    if (typeof payload.ver === 'number' && payload.ver !== u.tokenVersion) return null;
    return { userId: u.id, role: u.role };
  }
  // Legacy admin token (no sub) issued by the pre-multi-user server.
  if (payload.role === 'admin') {
    const admin = getAdmin();
    if (admin) return { userId: admin.id, role: 'admin' };
  }
  return null;
}
