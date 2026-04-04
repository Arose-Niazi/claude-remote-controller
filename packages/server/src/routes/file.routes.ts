import { Router } from 'express';

const router = Router();

// Phase 4: File transfer routes - stub for now
router.all('/*', (_req, res) => {
  res.status(501).json({ error: 'File transfer not implemented yet' });
});

export default router;
