import { Router } from 'express';
import { getAgentListForUser, getAgentSocketId } from '../agent-registry.js';
import { getOwner, listForUser, createAgent, deleteAgent } from '../agents-store.js';
import { getSessionsForAgent } from '../terminal-relay.js';
import { requireUser, type AuthedRequest } from '../auth-middleware.js';

const router = Router();

// Currently-online agents owned by the user (from the live registry).
router.get('/', requireUser, (req, res) => {
  res.json(getAgentListForUser((req as AuthedRequest).userId!));
});

// All enrolled agents owned by the user (incl. offline), with an online flag —
// for the "manage agents" UI.
router.get('/enrolled', requireUser, (req, res) => {
  const userId = (req as AuthedRequest).userId!;
  const list = listForUser(userId).map((a) => ({
    agentId: a.agentId,
    name: a.name,
    createdAt: a.createdAt,
    online: getAgentSocketId(a.agentId) !== undefined,
  }));
  res.json(list);
});

// Enroll a new agent for the user. Returns the plaintext secret ONCE.
router.post('/enroll', requireUser, (req, res) => {
  const userId = (req as AuthedRequest).userId!;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
  const created = createAgent(userId, name || undefined);
  res.json(created); // { agentId, secret, name }
});

router.delete('/:agentId', requireUser, (req, res) => {
  const userId = (req as AuthedRequest).userId!;
  const ok = deleteAgent(req.params.agentId, userId);
  if (!ok) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.json({ ok: true });
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
