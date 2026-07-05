import { Router } from 'express';
import { getAgentListForUser } from '../agent-registry.js';
import { getOwner } from '../agents-store.js';
import { getSessionsForAgent } from '../terminal-relay.js';
import { requireUser, type AuthedRequest } from '../auth-middleware.js';

const router = Router();

router.get('/', requireUser, (req, res) => {
  res.json(getAgentListForUser((req as AuthedRequest).userId!));
});

router.get('/:agentId/sessions', requireUser, (req, res) => {
  const userId = (req as AuthedRequest).userId!;
  if (getOwner(req.params.agentId) !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.json(getSessionsForAgent(req.params.agentId));
});

export default router;
