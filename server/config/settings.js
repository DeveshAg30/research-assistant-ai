/**
 * Runtime settings, read once from the environment. Kept in one place so
 * the layered timeouts and limits are easy to see side by side:
 *
 *   agent (AGENT_TIMEOUT_S=110s) < server -> AI service (120s) < client (130s)
 */
const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' ? value : fallback;
};

const RAW_AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

module.exports = {
  MAX_QUERY_LENGTH: 2000,
  // Render's private-network reference (fromService.hostport) is a bare
  // "host:port", so default to http:// when no scheme is given.
  AI_SERVICE_URL: /^https?:\/\//.test(RAW_AI_SERVICE_URL)
    ? RAW_AI_SERVICE_URL
    : `http://${RAW_AI_SERVICE_URL}`,
  AI_SERVICE_TOKEN: process.env.AI_SERVICE_TOKEN || '',
  AI_SERVICE_TIMEOUT_MS: num('AI_SERVICE_TIMEOUT_MS', 120000),

  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // Follow-up context sent to the agent.
  HISTORY_TURNS: num('HISTORY_TURNS', 6),
  HISTORY_TURN_CHARS: num('HISTORY_TURN_CHARS', 3000),

  // Rate limits and quotas.
  GLOBAL_RATE_LIMIT: num('GLOBAL_RATE_LIMIT', 300), // per IP per 15 min
  AUTH_RATE_LIMIT: num('AUTH_RATE_LIMIT', 10), // per IP per 15 min
  QUERY_RATE_LIMIT: num('QUERY_RATE_LIMIT', 10), // per user per minute
  DAILY_QUERY_LIMIT: num('DAILY_QUERY_LIMIT', 50), // per user per UTC day
  DAILY_GLOBAL_QUERY_LIMIT: num('DAILY_GLOBAL_QUERY_LIMIT', 2000),

  // Reports still "running" after this long are marked failed on startup.
  STALE_RUN_MS: num('STALE_RUN_MS', 10 * 60 * 1000),

  METRICS_TOKEN: process.env.METRICS_TOKEN || '',
};
