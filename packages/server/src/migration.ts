import { config } from './config.js';
import { logger } from './logger.js';
import * as users from './users.js';
import * as agentsStore from './agents-store.js';

/**
 * Idempotent first-boot migration that keeps the pre-multi-user deployment
 * working after the upgrade: seed an "admin" user from ADMIN_PASSWORD and adopt
 * the legacy env AGENTS map as that admin's agents. No-op on every boot after
 * the first (once users.json exists).
 */
export function runMigration(): void {
  if (users.userCount() > 0) return;

  const admin = users.createUser('admin', config.adminPassword, 'admin');
  logger.info({ userId: admin.id }, 'Seeded admin user from ADMIN_PASSWORD (username: admin)');

  let adopted = 0;
  for (const [agentId, secret] of Object.entries(config.agents)) {
    if (typeof secret === 'string' && secret) {
      agentsStore.adoptLegacyAgent(agentId, secret, admin.id);
      adopted++;
    }
  }
  if (adopted > 0) logger.info({ adopted }, 'Adopted legacy AGENTS as admin-owned');
}
