const { rateLimit } = require('express-rate-limit');
const settings = require('../config/settings');
const HttpError = require('../utils/httpError');

const reject = (message) => (req, res, next) =>
  next(new HttpError(429, 'RATE_LIMITED', message));

const common = { standardHeaders: 'draft-8', legacyHeaders: false };

/** Every request, per IP. */
const globalLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: settings.GLOBAL_RATE_LIMIT,
  handler: reject('Too many requests. Please slow down and try again shortly.'),
});

/** Login / register, per IP (slows down password guessing). */
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: settings.AUTH_RATE_LIMIT,
  handler: reject('Too many sign-in attempts. Please wait a few minutes.'),
});

/** Research queries, per signed-in user (must run after requireAuth). */
const queryLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: settings.QUERY_RATE_LIMIT,
  keyGenerator: (req) => `user:${req.user.id}`,
  handler: reject('You are sending questions too quickly. Please wait a minute.'),
});

module.exports = { globalLimiter, authLimiter, queryLimiter };
