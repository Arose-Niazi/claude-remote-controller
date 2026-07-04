import http from 'http';
import type { ClaudeHookPayload } from '@crc/shared';
import { logger } from './logger.js';

/**
 * A loopback-only HTTP server the Claude Code notify hooks POST to. This lets
 * Claude completion/permission events reach the agent even when Claude runs
 * OUTSIDE a CRC terminal (e.g. inside Warp or tmux on the PC), so they can be
 * forwarded to the server for Web Push.
 *
 * Bound to 127.0.0.1 only — never exposed off-machine.
 */
export function startLocalControl(
  port: number,
  onHook: (payload: ClaudeHookPayload) => void
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/hook') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 64 * 1024) req.destroy(); // cap
      });
      req.on('end', () => {
        try {
          // Accept both our simplified shape ({event}) and Claude Code's native
          // hook payload ({hook_event_name}); the caller normalizes it.
          const payload = JSON.parse(body) as ClaudeHookPayload;
          if (payload && typeof payload === 'object') onHook(payload);
        } catch {
          /* ignore malformed */
        }
        res.writeHead(204);
        res.end();
      });
      req.on('error', () => {
        res.writeHead(400);
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => {
    logger.warn({ err, port }, 'Local control server error (Claude hooks may not reach push)');
  });
  server.listen(port, '127.0.0.1', () => {
    logger.info({ port }, 'Local control endpoint listening (127.0.0.1) for Claude hooks');
  });
  return server;
}
