import { Router } from 'express';
import { getAgentList } from '../agent-registry.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(getAgentList());
});

export default router;
