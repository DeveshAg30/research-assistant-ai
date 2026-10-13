const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/settings');
const HttpError = require('../utils/httpError');

/** Verifies `Authorization: Bearer <jwt>` and sets req.user = { id, email }. */
module.exports = function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Please sign in to continue.'));
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    return next();
  } catch {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Your session has expired. Please sign in again.'));
  }
};
