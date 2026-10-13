const logger = require('../utils/logger');

/**
 * Centralized error handler. Every error response has the same shape:
 * { error, code, detail?, requestId } -- `code` drives the client's
 * user-facing message.
 */
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  let status = err.status || (res.statusCode >= 400 ? res.statusCode : 500);
  let code = err.code || 'INTERNAL';
  let message = err.message || 'Internal server error';

  if (err.name === 'ValidationError' || err.name === 'CastError') {
    status = 400;
    code = 'VALIDATION';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'VALIDATION';
    message = 'Request body is not valid JSON.';
  }
  if (typeof code !== 'string') code = 'INTERNAL';

  const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log({ err, requestId: req.id, status, code }, `${req.method} ${req.originalUrl} -> ${status}`);

  if (res.headersSent) return res.end();
  return res.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
    code,
    ...(err.detail && { detail: err.detail }),
    requestId: req.id,
  });
};
