const settings = require('../config/settings');
const HttpError = require('../utils/httpError');
const { createSseParser } = require('./sse');

/**
 * Streams one research run from the Python AI service.
 *
 * Calls `onEvent(name, data)` for every SSE event it relays. Resolves with
 * the `final` result; rejects with an HttpError carrying a stable code
 * (AI_UNAVAILABLE, AI_TIMEOUT, AGENT_ERROR, VALIDATION, CANCELLED).
 * Aborting `signal` (client disconnected) cancels the upstream request,
 * which in turn cancels the agent run.
 */
async function streamResearch({ query, chatHistory = [], requestId, signal, onEvent = () => {} }) {
  const timeoutSignal = AbortSignal.timeout(settings.AI_SERVICE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const abortError = () => {
    if (signal?.aborted) return new HttpError(499, 'CANCELLED', 'The request was cancelled.');
    return new HttpError(504, 'AI_TIMEOUT', 'The research agent took too long to answer.');
  };

  let response;
  try {
    response = await fetch(`${settings.AI_SERVICE_URL}/api/research/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Request-Id': requestId || '',
        ...(settings.AI_SERVICE_TOKEN && { 'X-Internal-Token': settings.AI_SERVICE_TOKEN }),
      },
      body: JSON.stringify({ query, chat_history: chatHistory }),
      signal: combined,
    });
  } catch (err) {
    if (combined.aborted) throw abortError();
    throw new HttpError(502, 'AI_UNAVAILABLE', 'The research service is unavailable.', err.message);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body.detail || body.error || '';
    } catch {
      /* non-JSON error body */
    }
    if (response.status === 400 || response.status === 422) {
      throw new HttpError(400, 'VALIDATION', detail || 'The research service rejected the query.');
    }
    if (response.status === 503 || response.status === 401) {
      throw new HttpError(503, 'AI_UNAVAILABLE', 'The research service is not ready.', detail);
    }
    throw new HttpError(502, 'AGENT_ERROR', 'The research agent failed.', detail);
  }

  let finalResult = null;
  let streamError = null;
  const parse = createSseParser((event, data) => {
    if (event === 'final') finalResult = data;
    else if (event === 'error') streamError = data;
    onEvent(event, data);
  });

  const decoder = new TextDecoder();
  try {
    for await (const chunk of response.body) {
      parse(decoder.decode(chunk, { stream: true }));
    }
  } catch (err) {
    if (combined.aborted) throw abortError();
    throw new HttpError(502, 'AGENT_ERROR', 'Lost connection to the research service.', err.message);
  }

  if (streamError) {
    const code = streamError.code === 'AI_TIMEOUT' ? 'AI_TIMEOUT' : 'AGENT_ERROR';
    throw new HttpError(code === 'AI_TIMEOUT' ? 504 : 502, code, 'The research agent failed.', streamError.detail);
  }
  if (!finalResult) {
    throw new HttpError(502, 'AGENT_ERROR', 'The research service closed the stream unexpectedly.');
  }
  return finalResult;
}

module.exports = { streamResearch };
