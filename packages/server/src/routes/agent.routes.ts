import { Router } from 'express';
import { getAgentList } from '../agent-registry.js';
import { getSessionsForAgent } from '../terminal-relay.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(getAgentList());
});

router.get('/:agentId/sessions', (req, res) => {
  res.json(getSessionsForAgent(req.params.agentId));
});

export default router;
