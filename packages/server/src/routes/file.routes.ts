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
import { requireUser, authenticate } from '../auth-middleware.js';
import { getOwner, authenticateAgent } from '../agents-store.js';
import { FILE_MAX_SIZE } from '@crc/shared';

const router = Router();

// Bytes currently being streamed across all in-flight uploads/receives, so the
// total-storage cap accounts for concurrent uploads that haven't landed on disk
// yet (getStoredBytes only sees finalized files).
let inFlightBytes = 0;

// Auth middleware — allows Bearer token OR agent X-Agent-Id/X-Agent-Secret headers
function authMiddleware(req: any, res: any, next: any): void {
  if (req.path.startsWith('/d/')) return next();

  // Bearer token — resolve to a live user (rejects revoked/deleted-user tokens).
  if (authenticate(req)) return next();

  // Agent auth (for file-explorer receives) — validated against the agent store.
  const agentId = req.headers['x-agent-id'] as string;
  const agentSecret = req.headers['x-agent-secret'] as string;
  if (agentId && agentSecret && authenticateAgent(agentId, agentSecret) !== null) {
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
  begin: (fileName: string, ownerUserId?: string) => PendingStore,
  fileName: string,
  ownerUserId?: string,
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

  const pending = begin(fileName, ownerUserId);
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
router.post('/upload', requireUser, (req: any, res) => {
  const fileName = (req.headers['x-file-name'] as string) || 'upload';
  streamToStore(req, res, beginUpload, fileName, req.userId);
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

// Agent uploads file for phone to download. Authed via X-Agent-Id/X-Agent-Secret
// by the global authMiddleware; tag the received file with the agent OWNER's
// userId so it only surfaces in that owner's pending list.
router.post('/receive', (req, res) => {
  const fileName = (req.headers['x-file-name'] as string) || 'download';
  const agentId = req.headers['x-agent-id'] as string;
  const ownerUserId = agentId ? getOwner(agentId) : undefined;
  streamToStore(req, res, beginReceive, fileName, ownerUserId);
});

// List files waiting for phone download — only the requesting user's receives.
router.get('/pending', requireUser, (req: any, res) => {
  res.json(getPendingReceives(req.userId));
});

export default router;
