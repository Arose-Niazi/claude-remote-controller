export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  dataDir: process.env.DATA_DIR || './data',
  adminPassword: process.env.ADMIN_PASSWORD || 'changeme',
  tokenSecret: process.env.TOKEN_SECRET || 'dev-secret-change-in-production',
  agents: JSON.parse(process.env.AGENTS || '{}') as Record<string, string>,
  nodeEnv: process.env.NODE_ENV || 'development',
};
