require('dotenv').config();

const connectDB = require('./config/db');
const settings = require('./config/settings');
const logger = require('./utils/logger');
const ResearchReport = require('./models/ResearchReport');
const { createApp } = require('./app');
const { sweepStaleRuns } = require('./controllers/queryController');

const PORT = process.env.PORT || 5000;

async function main() {
  if (!settings.JWT_SECRET || settings.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set to a random string of at least 32 characters.');
  }
  if (!settings.AI_SERVICE_TOKEN) {
    logger.warn('AI_SERVICE_TOKEN is not set; calls to the AI service are unauthenticated.');
  }

  await connectDB();
  // Replaces the old global text index with the per-user one, etc.
  await ResearchReport.syncIndexes();

  const swept = await sweepStaleRuns();
  if (swept) logger.info(`Marked ${swept} interrupted research run(s) as failed.`);
  setInterval(() => sweepStaleRuns().catch((err) => logger.error({ err }, 'Stale-run sweep failed')), 5 * 60 * 1000).unref();

  createApp().listen(PORT, () => {
    logger.info(`[server] Listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  logger.fatal({ err }, '[server] Fatal startup error');
  process.exit(1);
});
