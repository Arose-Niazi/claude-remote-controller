import fs from 'fs';
import path from 'path';
import { createHmac, timingSafeEqual } from 'crypto';
import { v4 as uuid } from 'uuid';
import { FILE_TTL, FILE_CLEANUP_INTERVAL, FILE_MAX_STORAGE } from '@crc/shared';
import { config } from './config.js';
import { logger } from './logger.js';

const uploadsDir = () => path.join(config.dataDir, 'tmp', 'uploads');
const receivesDir = () => path.join(config.dataDir, 'tmp', 'receives');

function ensureDirs(): void {
  fs.mkdirSync(uploadsDir(), { recursive: true });
  fs.mkdirSync(receivesDir(), { recursive: true });
}

export interface StoredFile {
  fileId: string;
  fileName: string;
  size: number;
  downloadUrl: string;
  expiresAt: number;
  ownerUserId?: string;
}

// Handle returned by beginStore — the caller streams bytes into dataPath, then
// calls finalize(size) (or abort() on error) to write meta.json and obtain the
// StoredFile metadata. This keeps memory bounded for large uploads.
export interface PendingStore {
  fileId: string;
  dataPath: string;
  finalize: (size: number) => StoredFile;
  abort: () => void;
}

function beginStore(baseDir: string, fileName: string, ownerUserId?: string): PendingStore {
  ensureDirs();
  const fileId = uuid();
  const dir = path.join(baseDir, fileId);
  fs.mkdirSync(dir, { recursive: true });
  const dataPath = path.join(dir, 'data');

  return {
    fileId,
    dataPath,
    finalize(size: number): StoredFile {
      const expiresAt = Date.now() + FILE_TTL;
      const meta = { fileName, size, uploadedAt: Date.now(), expiresAt, downloaded: false, ownerUserId };
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
      const downloadUrl = `/api/files/d/${generateSignedToken(fileId, expiresAt)}`;
      return { fileId, fileName, size, downloadUrl, expiresAt, ownerUserId };
    },
    abort(): void {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function beginUpload(fileName: string, ownerUserId?: string): PendingStore {
  return beginStore(uploadsDir(), fileName, ownerUserId);
}

export function beginReceive(fileName: string, ownerUserId?: string): PendingStore {
  return beginStore(receivesDir(), fileName, ownerUserId);
}

// Sum the bytes of all stored data files across uploads + receives, so callers
// can enforce FILE_MAX_STORAGE before accepting a new file.
export function getStoredBytes(): number {
  let total = 0;
  for (const baseDir of [uploadsDir(), receivesDir()]) {
    if (!fs.existsSync(baseDir)) continue;
    for (const fileId of fs.readdirSync(baseDir)) {
      const dataPath = path.join(baseDir, fileId, 'data');
      try {
        total += fs.statSync(dataPath).size;
      } catch {
        // Missing/unreadable data file — ignore.
      }
    }
  }
  return total;
}

export function getStorageCap(): number {
  return FILE_MAX_STORAGE;
}

export function getFileByToken(token: string): { filePath: string; fileName: string } | null {
  const parsed = validateSignedToken(token);
  if (!parsed) return null;

  // Look in both uploads and receives
  for (const baseDir of [uploadsDir(), receivesDir()]) {
    const dir = path.join(baseDir, parsed.fileId);
    const metaPath = path.join(dir, 'meta.json');
    const dataPath = path.join(dir, 'data');
    if (fs.existsSync(metaPath) && fs.existsSync(dataPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        return { filePath: dataPath, fileName: meta.fileName };
      } catch {
        // Corrupt meta.json — treat as not-found.
        return null;
      }
    }
  }
  return null;
}

// Mark a downloaded receive so getPendingReceives stops re-listing it. Called
// after a successful download. Looks in receives only (uploads aren't listed).
export function markDownloaded(token: string): void {
  const parsed = validateSignedToken(token);
  if (!parsed) return;
  const metaPath = path.join(receivesDir(), parsed.fileId, 'meta.json');
  if (!fs.existsSync(metaPath)) return;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.downloaded = true;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
  } catch {
    // Corrupt meta.json — nothing to update.
  }
}

export function getPendingReceives(userId?: string): StoredFile[] {
  ensureDirs();
  const result: StoredFile[] = [];
  const dir = receivesDir();
  if (!fs.existsSync(dir)) return result;

  for (const fileId of fs.readdirSync(dir)) {
    const metaPath = path.join(dir, fileId, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    let meta: any;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      // Corrupt meta.json — skip this entry.
      continue;
    }
    if (meta.downloaded || meta.expiresAt < Date.now()) continue;
    // Per-user isolation: when a userId is given, only surface receives owned by
    // that user so users can't see each other's transferred files.
    if (userId !== undefined && meta.ownerUserId !== userId) continue;
    result.push({
      fileId,
      fileName: meta.fileName,
      size: meta.size,
      downloadUrl: `/api/files/d/${generateSignedToken(fileId, meta.expiresAt)}`,
      expiresAt: meta.expiresAt,
      ownerUserId: meta.ownerUserId,
    });
  }
  return result;
}

function generateSignedToken(fileId: string, expiresAt: number): string {
  const payload = `${fileId}:${expiresAt}`;
  const sig = createHmac('sha256', config.tokenSecret).update(payload).digest('base64url');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function validateSignedToken(token: string): { fileId: string; expiresAt: number } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [fileId, expiresAtStr, sig] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);
    if (Date.now() > expiresAt) return null;

    const expectedSig = createHmac('sha256', config.tokenSecret).update(`${fileId}:${expiresAt}`).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
    return { fileId, expiresAt };
  } catch {
    return null;
  }
}

export function cleanupExpired(): { removed: number; kept: number } {
  let removed = 0;
  let kept = 0;
  for (const baseDir of [uploadsDir(), receivesDir()]) {
    if (!fs.existsSync(baseDir)) continue;
    for (const fileId of fs.readdirSync(baseDir)) {
      const dir = path.join(baseDir, fileId);
      const metaPath = path.join(dir, 'meta.json');
      if (!fs.existsSync(metaPath)) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
        continue;
      }
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.expiresAt < Date.now()) {
          fs.rmSync(dir, { recursive: true, force: true });
          removed++;
        } else {
          kept++;
        }
      } catch {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      }
    }
  }
  if (removed > 0 || kept > 0) {
    logger.info({ removed, kept, intervalMs: FILE_CLEANUP_INTERVAL }, 'File cleanup cycle');
  }
  return { removed, kept };
}

export function startCleanupInterval(): void {
  // Run once at startup so expired files from a previous session don't sit
  // around for up to FILE_CLEANUP_INTERVAL after a restart.
  cleanupExpired();
  setInterval(cleanupExpired, FILE_CLEANUP_INTERVAL);
}
