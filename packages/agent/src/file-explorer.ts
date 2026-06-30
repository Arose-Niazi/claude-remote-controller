import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';
import { FILE_MAX_SIZE } from '@crc/shared';
import type { FileEntry } from '@crc/shared';

// The agent's own config/secret directory. Browsing or downloading anything
// inside it (e.g. the agent secret) is denied so it can't be exfiltrated.
const SECRET_DIR = path.join(os.homedir(), '.crc-agent');

// True if `resolved` is the secret dir itself or any descendant of it.
function isInSecretDir(resolved: string): boolean {
  const rel = path.relative(SECRET_DIR, resolved);
  // Empty rel => same path. A rel that doesn't start with '..' and isn't
  // absolute means resolved is inside SECRET_DIR.
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

export function listDirectory(dirPath: string): { entries: FileEntry[]; error?: string } {
  try {
    const resolved = path.resolve(dirPath);
    if (isInSecretDir(resolved)) {
      return { entries: [], error: 'Access denied' };
    }
    if (!fs.existsSync(resolved)) {
      return { entries: [], error: 'Path does not exist' };
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return { entries: [], error: 'Not a directory' };
    }

    const dirents = fs.readdirSync(resolved, { withFileTypes: true });
    const entries: FileEntry[] = [];

    for (const dirent of dirents) {
      try {
        const fullPath = path.join(resolved, dirent.name);
        const s = fs.statSync(fullPath);
        entries.push({
          name: dirent.name,
          isDirectory: dirent.isDirectory(),
          size: dirent.isDirectory() ? 0 : s.size,
          modified: s.mtimeMs,
        });
      } catch {
        // Skip files we can't stat (permission denied, etc.)
      }
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { entries };
  } catch (err: any) {
    logger.error({ path: dirPath, error: err.message }, 'Failed to list directory');
    return { entries: [], error: err.message };
  }
}

export async function downloadFile(
  filePath: string,
  serverUrl: string,
  secret: string,
  agentId: string
): Promise<{ fileId: string; fileName: string; downloadUrl: string; size: number } | { error: string }> {
  try {
    const resolved = path.resolve(filePath);
    if (isInSecretDir(resolved)) {
      return { error: 'Access denied' };
    }
    if (!fs.existsSync(resolved)) {
      return { error: 'File does not exist' };
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return { error: 'Cannot download a directory' };
    }
    if (stat.size > FILE_MAX_SIZE) {
      return { error: `File too large (max ${FILE_MAX_SIZE} bytes)` };
    }

    const fileName = path.basename(resolved);
    // Stream the file rather than reading it fully into memory, so large
    // downloads stay memory-bounded.
    const fileStream = fs.createReadStream(resolved);

    // POST to server's receive endpoint
    const baseUrl = serverUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    const url = `${baseUrl}/api/files/receive`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-File-Name': fileName,
        'X-Agent-Id': agentId,
        'X-Agent-Secret': secret,
        'Content-Length': String(stat.size),
      },
      body: fileStream as any,
      duplex: 'half',
    } as any);

    if (!res.ok) {
      return { error: `Upload failed: ${res.status}` };
    }

    const result = await res.json();
    return {
      fileId: result.fileId,
      fileName: result.fileName,
      downloadUrl: result.downloadUrl,
      size: stat.size,
    };
  } catch (err: any) {
    logger.error({ path: filePath, error: err.message }, 'Failed to download file');
    return { error: err.message };
  }
}
