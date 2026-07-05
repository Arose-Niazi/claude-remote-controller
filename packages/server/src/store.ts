import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { logger } from './logger.js';

// Tiny atomic JSON file store under DATA_DIR. Zero dependencies; fits the
// self-hostable, no-external-database goal. Swap point for SQLite later.

export function loadJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(path.join(config.dataDir, file), 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function saveJson(file: string, data: unknown): void {
  const target = path.join(config.dataDir, file);
  const tmp = `${target}.tmp`;
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, target); // atomic replace on the same filesystem
  } catch (err) {
    logger.warn({ err, file }, 'Failed to persist store');
  }
}
