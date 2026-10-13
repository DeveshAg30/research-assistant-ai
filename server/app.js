const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const { register: metricsRegistry, httpDuration } = require('./utils/metrics');
const settings = require('./config/settings');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const { globalLimiter } = require('./middleware/rateLimit');
const HttpError = require('./utils/httpError');
const authRoutes = require('./routes/authRoutes');
const researchRoutes = require('./routes/researchRoutes');

/** Builds the Express app (no DB connection or listen -- see server.js). */
function createApp() {
  const app = express();
  const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Behind Render/Vercel proxies, so rate limits see the real client IP.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use((req, res, next) => {
    const end = httpDuration.startTimer({ method: req.method });
    res.on('finish', () => end({ route: req.route?.path || 'unmatched', status: res.statusCode }));
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: clientOrigins, exposedHeaders: ['X-Request-Id'] }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'research-assistant-server' });
  });

  // Prometheus scrape endpoint: open in dev, Bearer METRICS_TOKEN in production.
  app.get('/metrics', async (req, res, next) => {
    const authorised = settings.METRICS_TOKEN
      ? req.get('authorization') === `Bearer ${settings.METRICS_TOKEN}`
      : process.env.NODE_ENV !== 'production';
    if (!authorised) return next(new HttpError(404, 'NOT_FOUND', 'Not found'));
    res.set('Content-Type', metricsRegistry.contentType);
    return res.send(await metricsRegistry.metrics());
  });

  app.use('/api', globalLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api', researchRoutes);

  app.use((req, res, next) => {
    next(new HttpError(404, 'NOT_FOUND', `Not found: ${req.method} ${req.originalUrl}`));
  });
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
