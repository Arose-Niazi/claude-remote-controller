import fs from 'fs';
import path from 'path';
import { createHmac } from 'crypto';
import { v4 as uuid } from 'uuid';
import { FILE_TTL, FILE_CLEANUP_INTERVAL, FILE_MAX_SIZE } from '@crc/shared';
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
}

export function storeUpload(fileBuffer: Buffer, fileName: string): StoredFile {
  ensureDirs();
  const fileId = uuid();
  const dir = path.join(uploadsDir(), fileId);
  fs.mkdirSync(dir, { recursive: true });

  const expiresAt = Date.now() + FILE_TTL;
  const meta = { fileName, size: fileBuffer.length, uploadedAt: Date.now(), expiresAt, downloaded: false };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'data'), fileBuffer);

  const downloadUrl = `/api/files/d/${generateSignedToken(fileId, expiresAt)}`;
  return { fileId, fileName, size: fileBuffer.length, downloadUrl, expiresAt };
}

export function storeReceive(fileBuffer: Buffer, fileName: string): StoredFile {
  ensureDirs();
  const fileId = uuid();
  const dir = path.join(receivesDir(), fileId);
  fs.mkdirSync(dir, { recursive: true });

  const expiresAt = Date.now() + FILE_TTL;
  const meta = { fileName, size: fileBuffer.length, uploadedAt: Date.now(), expiresAt, downloaded: false };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  fs.writeFileSync(path.join(dir, 'data'), fileBuffer);

  const downloadUrl = `/api/files/d/${generateSignedToken(fileId, expiresAt)}`;
  return { fileId, fileName, size: fileBuffer.length, downloadUrl, expiresAt };
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
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      return { filePath: dataPath, fileName: meta.fileName };
    }
  }
  return null;
}

export function getPendingReceives(): StoredFile[] {
  ensureDirs();
  const result: StoredFile[] = [];
  const dir = receivesDir();
  if (!fs.existsSync(dir)) return result;

  for (const fileId of fs.readdirSync(dir)) {
    const metaPath = path.join(dir, fileId, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.downloaded || meta.expiresAt < Date.now()) continue;
    result.push({
      fileId,
      fileName: meta.fileName,
      size: meta.size,
      downloadUrl: `/api/files/d/${generateSignedToken(fileId, meta.expiresAt)}`,
      expiresAt: meta.expiresAt,
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
    if (sig !== expectedSig) return null;
    return { fileId, expiresAt };
  } catch {
    return null;
  }
}

export function cleanupExpired(): void {
  for (const baseDir of [uploadsDir(), receivesDir()]) {
    if (!fs.existsSync(baseDir)) continue;
    for (const fileId of fs.readdirSync(baseDir)) {
      const metaPath = path.join(baseDir, fileId, 'meta.json');
      if (!fs.existsSync(metaPath)) {
        fs.rmSync(path.join(baseDir, fileId), { recursive: true, force: true });
        continue;
      }
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.expiresAt < Date.now()) {
          fs.rmSync(path.join(baseDir, fileId), { recursive: true, force: true });
          logger.debug({ fileId }, 'Cleaned up expired file');
        }
      } catch {
        fs.rmSync(path.join(baseDir, fileId), { recursive: true, force: true });
      }
    }
  }
}

export function startCleanupInterval(): void {
  setInterval(cleanupExpired, FILE_CLEANUP_INTERVAL);
}
