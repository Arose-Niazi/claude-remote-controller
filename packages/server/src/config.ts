const DEV_TOKEN_SECRET = 'dev-secret-change-in-production';
const DEV_ADMIN_PASSWORD = 'changeme';

const nodeEnv = process.env.NODE_ENV || 'development';

// [#2] In production, refuse to start with the insecure dev defaults still in place.
if (nodeEnv === 'production') {
  const missing: string[] = [];
  if (process.env.TOKEN_SECRET === undefined) missing.push('TOKEN_SECRET');
  if (process.env.ADMIN_PASSWORD === undefined) missing.push('ADMIN_PASSWORD');
  if (missing.length > 0) {
    console.error(
      `FATAL: refusing to start in production with insecure defaults. ` +
        `Set the following environment variable(s) to secure values: ${missing.join(', ')}.`
    );
    process.exit(1);
  }
}

// [#45] Guard against a malformed AGENTS env var crashing the process at import time.
let agents: Record<string, string> = {};
try {
  agents = JSON.parse(process.env.AGENTS || '{}') as Record<string, string>;
} catch (err) {
  console.warn(
    `WARNING: failed to parse AGENTS env var as JSON; falling back to no configured agents. ` +
      `Error: ${(err as Error).message}`
  );
  agents = {};
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  dataDir: process.env.DATA_DIR || './data',
  adminPassword: process.env.ADMIN_PASSWORD || DEV_ADMIN_PASSWORD,
  tokenSecret: process.env.TOKEN_SECRET || DEV_TOKEN_SECRET,
  agents,
  nodeEnv,
  // Comma-separated allowed web origins for CORS. Empty => same-origin only.
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Web Push (VAPID). When unset, push is disabled and the app falls back to
  // in-app toasts + foreground browser notifications only.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
};
