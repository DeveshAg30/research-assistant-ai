const crypto = require('crypto');

/** Accept or create X-Request-Id; it is forwarded to the AI service too. */
module.exports = function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
};
