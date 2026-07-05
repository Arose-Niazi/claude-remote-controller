const DEV_TOKEN_SECRET = 'dev-secret-change-in-production';
const DEV_ADMIN_PASSWORD = 'changeme';

const nodeEnv = process.env.NODE_ENV || 'development';

// [#2] In production, refuse to start with insecure/placeholder secrets in place.
// A weak TOKEN_SECRET lets anyone forge login tokens (incl. admin), so we validate
// strength here rather than merely checking the var is defined.
if (nodeEnv === 'production') {
  const problems: string[] = [];

  // Obvious placeholder/example values that must never reach production.
  const WEAK_SECRETS = new Set([
    DEV_TOKEN_SECRET,
    'random-64-char-hex-string',
    'changeme',
    'change-me',
    'replace-me',
    'secret',
    'REPLACE_WITH_A_RANDOM_32_BYTE_HEX_STRING',
    'REPLACE_WITH_64_CHAR_RANDOM_HEX',
  ]);
  const WEAK_PASSWORDS = new Set([DEV_ADMIN_PASSWORD, 'change-me', 'password', 'admin']);
  const ts = process.env.TOKEN_SECRET;
  if (ts === undefined) {
    problems.push('TOKEN_SECRET is not set');
  } else if (ts.length < 32 || WEAK_SECRETS.has(ts.trim())) {
    problems.push(
      'TOKEN_SECRET is too weak — use a random value with at least 32 chars, e.g. ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`'
    );
  }

  const ap = process.env.ADMIN_PASSWORD;
  if (ap === undefined) {
    problems.push('ADMIN_PASSWORD is not set');
  } else if (ap.length < 8 || WEAK_PASSWORDS.has(ap.trim())) {
    problems.push('ADMIN_PASSWORD is too weak — use at least 8 characters and not a placeholder');
  }

  if (problems.length > 0) {
    console.error(
      `FATAL: refusing to start in production with insecure configuration:\n` +
        problems.map((p) => `  - ${p}`).join('\n')
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
