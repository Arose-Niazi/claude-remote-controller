import { Router } from 'express';
import { config } from '../config.js';
import { generateToken } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password !== config.adminPassword) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  const token = generateToken({ role: 'admin', iat: Date.now() });
  res.json({ token });
});

export default router;
