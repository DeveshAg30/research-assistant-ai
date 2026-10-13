/**
 * Maps the server's stable error `code`s to messages a user can act on.
 * Server-provided text is used when it is more specific (e.g. quota counts).
 */
const MESSAGES = {
  VALIDATION: 'That request was not valid. Please check your input and try again.',
  QUERY_TOO_LONG: 'Your question is too long. Please shorten it to 2,000 characters or fewer.',
  UNAUTHORIZED: 'Please sign in to continue.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  EMAIL_TAKEN: 'An account with this email already exists. Try signing in instead.',
  NOT_FOUND: 'That item could not be found. It may have been removed.',
  RATE_LIMITED: 'You are sending requests too quickly. Please wait a moment and try again.',
  QUOTA_EXCEEDED: 'You have reached your daily research limit. It resets at midnight UTC.',
  CONCURRENT_RUN: 'You already have a question being researched. Wait for it to finish or cancel it.',
  AI_UNAVAILABLE: 'The research service is unavailable right now. Please try again in a minute.',
  AI_TIMEOUT: 'The research took too long and was stopped. Try a narrower question.',
  AGENT_ERROR: 'The research agent ran into a problem while answering. Please retry.',
  INTERRUPTED: 'This research run was interrupted by a server restart. Please retry.',
  CANCELLED: 'You cancelled this research run.',
  NETWORK: 'Could not reach the server. Check your connection and try again.',
};

const PREFER_SERVER_TEXT = new Set(['QUOTA_EXCEEDED', 'QUERY_TOO_LONG', 'VALIDATION', 'CONCURRENT_RUN']);

export function messageFor(code, serverMessage) {
  if (serverMessage && (PREFER_SERVER_TEXT.has(code) || !MESSAGES[code])) return serverMessage;
  return MESSAGES[code] || serverMessage || 'Something went wrong. Please try again.';
}

/** Normalise an axios error / stream error payload to { code, message, detail }. */
export function toUserError(err) {
  const body = err?.response?.data || err?.body || err || {};
  // No response at all (axios) means the server was unreachable.
  const code = body.code || (err?.response || err?.status ? 'INTERNAL' : 'NETWORK');
  return {
    code,
    message: messageFor(code, body.error),
    detail: body.detail || '',
    requestId: body.requestId || '',
  };
}
