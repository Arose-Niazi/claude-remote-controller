import { randomBytes, randomUUID } from 'crypto';
import { loadJson, saveJson } from './store.js';
import { hashSecret, verifySecret } from './hash.js';
import { logger } from './logger.js';

export interface AgentRecord {
  agentId: string;
  secretHash: string;
  ownerUserId: string;
  name: string;
  createdAt: number;
}

const FILE = 'agents.json';
let records: AgentRecord[] = loadJson<AgentRecord[]>(FILE, []);

function persist(): void {
  saveJson(FILE, records);
}

export function recordCount(): number {
  return records.length;
}

/** Returns the owner's userId if agentId+secret is valid, else null. */
export function authenticateAgent(agentId: string, secret: string): string | null {
  const rec = records.find((r) => r.agentId === agentId);
  if (!rec) return null;
  return verifySecret(secret, rec.secretHash) ? rec.ownerUserId : null;
}

export function getOwner(agentId: string): string | undefined {
  return records.find((r) => r.agentId === agentId)?.ownerUserId;
}

export function listForUser(userId: string): AgentRecord[] {
  return records.filter((r) => r.ownerUserId === userId);
}

/** Enroll a new agent for a user; returns the plaintext secret ONCE. */
export function createAgent(ownerUserId: string, name?: string): { agentId: string; secret: string; name: string } {
  const slug = (name || 'agent').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 24) || 'agent';
  const agentId = `${slug}-${randomUUID().slice(0, 8)}`;
  const secret = randomBytes(24).toString('base64url');
  records.push({ agentId, secretHash: hashSecret(secret), ownerUserId, name: name || slug, createdAt: Date.now() });
  persist();
  logger.info({ agentId, ownerUserId }, 'Agent enrolled');
  return { agentId, secret, name: name || slug };
}

/** Delete an agent, but only if owned by the requesting user. */
export function deleteAgent(agentId: string, ownerUserId: string): boolean {
  const before = records.length;
  records = records.filter((r) => !(r.agentId === agentId && r.ownerUserId === ownerUserId));
  if (records.length !== before) {
    persist();
    return true;
  }
  return false;
}

/** Migration: adopt a legacy env-configured agent (idempotent). */
export function adoptLegacyAgent(agentId: string, secret: string, ownerUserId: string): void {
  if (records.some((r) => r.agentId === agentId)) return;
  records.push({ agentId, secretHash: hashSecret(secret), ownerUserId, name: agentId, createdAt: Date.now() });
  persist();
  logger.info({ agentId, ownerUserId }, 'Adopted legacy agent');
}
