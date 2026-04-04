import { Router } from 'express';
import { storeUpload, storeReceive, getFileByToken, getPendingReceives } from '../file-store.js';
import { verifyToken } from '../auth.js';
import { FILE_MAX_SIZE } from '@crc/shared';

const router = Router();

// Auth middleware for file routes (except signed download)
function authMiddleware(req: any, res: any, next: any): void {
  if (req.path.startsWith('/d/')) return next();
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  if (!verifyToken(auth.slice(7))) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  next();
}

router.use(authMiddleware);

// Phone uploads file for agent to download via curl
router.post('/upload', (req, res) => {
  const chunks: Buffer[] = [];
  let size = 0;
  const fileName = (req.headers['x-file-name'] as string) || 'upload';

  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > FILE_MAX_SIZE) {
      res.status(413).json({ error: 'File too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (res.headersSent) return;
    const buffer = Buffer.concat(chunks);
    const result = storeUpload(buffer, fileName);
    res.json(result);
  });
});

// Signed download URL — no auth header needed
router.get('/d/:token', (req, res) => {
  const file = getFileByToken(req.params.token);
  if (!file) {
    res.status(404).json({ error: 'File not found or expired' });
    return;
  }
  res.download(file.filePath, file.fileName);
});

// Agent uploads file for phone to download
router.post('/receive', (req, res) => {
  const chunks: Buffer[] = [];
  let size = 0;
  const fileName = (req.headers['x-file-name'] as string) || 'download';

  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > FILE_MAX_SIZE) {
      res.status(413).json({ error: 'File too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    if (res.headersSent) return;
    const buffer = Buffer.concat(chunks);
    const result = storeReceive(buffer, fileName);
    res.json(result);
  });
});

// List files waiting for phone download
router.get('/pending', (_req, res) => {
  res.json(getPendingReceives());
});

export default router;
