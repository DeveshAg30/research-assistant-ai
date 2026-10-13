/**
 * An error with an HTTP status and a stable machine-readable `code` that
 * the client maps to a friendly message (client/src/errorMessages.js).
 */
class HttpError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

module.exports = HttpError;
