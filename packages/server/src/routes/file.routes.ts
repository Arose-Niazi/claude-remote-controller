import fs from 'fs';
import { Router } from 'express';
import {
  beginUpload,
  beginReceive,
  getFileByToken,
  getPendingReceives,
  getStoredBytes,
  getStorageCap,
  markDownloaded,
  type PendingStore,
  type StoredFile,
} from '../file-store.js';
import { verifyToken, validateAgentAuth } from '../auth.js';
import { FILE_MAX_SIZE } from '@crc/shared';

const router = Router();

// Bytes currently being streamed across all in-flight uploads/receives, so the
// total-storage cap accounts for concurrent uploads that haven't landed on disk
// yet (getStoredBytes only sees finalized files).
let inFlightBytes = 0;

// Auth middleware — allows Bearer token OR agent X-Agent-Id/X-Agent-Secret headers
function authMiddleware(req: any, res: any, next: any): void {
  if (req.path.startsWith('/d/')) return next();

  // Try Bearer token first
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ') && verifyToken(auth.slice(7))) {
    return next();
  }

  // Try agent auth (for file-explorer downloads)
  const agentId = req.headers['x-agent-id'] as string;
  const agentSecret = req.headers['x-agent-secret'] as string;
  if (agentId && agentSecret && validateAgentAuth(agentId, agentSecret)) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized' });
}

router.use(authMiddleware);

// Stream the request body straight to disk, enforcing both the per-file size
// cap (413) and the total storage cap (507) as bytes flow so memory stays
// bounded for large files. On success, finalizes meta and returns StoredFile.
function streamToStore(
  req: any,
  res: any,
  begin: (fileName: string) => PendingStore,
  fileName: string,
): void {
  // Snapshot finalized bytes on disk; add live in-flight bytes so concurrent
  // uploads are accounted for. Reject up front if already at/over cap.
  const diskBytes = getStoredBytes();
  const cap = getStorageCap();
  if (diskBytes + inFlightBytes >= cap) {
    res.status(507).json({ error: 'Insufficient storage' });
    req.destroy();
    return;
  }

  const pending = begin(fileName);
  const out = fs.createWriteStream(pending.dataPath);
  let size = 0;
  let counted = 0; // bytes this request has added to inFlightBytes
  let aborted = false;

  const release = (): void => {
    inFlightBytes -= counted;
    counted = 0;
  };

  const fail = (status: number, error: string): void => {
    if (aborted) return;
    aborted = true;
    release();
    if (!out.destroyed) out.destroy();
    pending.abort();
    if (!res.headersSent) res.status(status).json({ error });
    req.destroy();
  };

  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    size += chunk.length;
    inFlightBytes += chunk.length;
    counted += chunk.length;
    if (size > FILE_MAX_SIZE) {
      fail(413, 'File too large');
      return;
    }
    if (diskBytes + inFlightBytes > cap) {
      fail(507, 'Insufficient storage');
      return;
    }
    // Honor backpressure so memory stays bounded if the producer outruns disk.
    if (!out.write(chunk)) {
      req.pause();
      out.once('drain', () => {
        if (!aborted) req.resume();
      });
    }
  });

  req.on('error', () => fail(400, 'Upload failed'));
  out.on('error', () => fail(500, 'Write failed'));

  req.on('end', () => {
    if (aborted) return;
    out.end(() => {
      if (aborted) return;
      // Bytes are now finalized on disk; stop counting them as in-flight.
      release();
      const result: StoredFile = pending.finalize(size);
      res.json(result);
    });
  });
}

// Phone uploads file for agent to download via curl
router.post('/upload', (req, res) => {
  const fileName = (req.headers['x-file-name'] as string) || 'upload';
  streamToStore(req, res, beginUpload, fileName);
});

// Signed download URL — no auth header needed
router.get('/d/:token', (req, res) => {
  const token = req.params.token;
  const file = getFileByToken(token);
  if (!file) {
    res.status(404).json({ error: 'File not found or expired' });
    return;
  }
  res.download(file.filePath, file.fileName, (err) => {
    // Mark as downloaded only on a successful send so getPendingReceives stops
    // re-listing it for the remainder of the TTL.
    if (!err) markDownloaded(token);
  });
});

// Agent uploads file for phone to download
router.post('/receive', (req, res) => {
  const fileName = (req.headers['x-file-name'] as string) || 'download';
  streamToStore(req, res, beginReceive, fileName);
});

// List files waiting for phone download
router.get('/pending', (_req, res) => {
  res.json(getPendingReceives());
});

export default router;
