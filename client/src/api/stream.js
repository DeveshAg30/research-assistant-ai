import { API_BASE_URL, getToken } from './client';

// Longer than the server's upstream timeout (120s), which is longer than
// the agent's own limit (110s), so the innermost layer fails first and
// its specific error reaches the user.
export const STREAM_TIMEOUT_MS = 130000;

/** Incremental SSE parser: feed text chunks, receives (event, data) callbacks. */
export function createSseParser(onEvent) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const data = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) {
        try {
          onEvent(event, JSON.parse(data.join('\n')));
        } catch {
          onEvent(event, data.join('\n'));
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  };
}

/**
 * POST /query/stream and dispatch each server-sent event to `onEvent`.
 * Uses fetch (not EventSource) so it can POST and send the Bearer token.
 * Abort `signal` to cancel: the server then cancels the agent run.
 *
 * Rejects with { body: { code, error, ... } } for non-2xx responses,
 * { code: 'CANCELLED' } when aborted by the caller, or AI_TIMEOUT.
 */
export async function streamQuery({ query, sessionId, signal, onEvent, fetchImpl = fetch }) {
  const timeout = AbortSignal.timeout(STREAM_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const token = getToken();

  const abortReason = () =>
    signal?.aborted ? { code: 'CANCELLED', body: { code: 'CANCELLED' } } : { code: 'AI_TIMEOUT', body: { code: 'AI_TIMEOUT' } };

  let response;
  try {
    response = await fetchImpl(`${API_BASE_URL}/query/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ query, ...(sessionId && { sessionId }) }),
      signal: combined,
    });
  } catch {
    throw combined.aborted ? abortReason() : { code: 'NETWORK', body: { code: 'NETWORK' } };
  }

  if (!response.ok) {
    let body = {};
    try {
      body = await response.json();
    } catch {
      /* ignore */
    }
    throw { status: response.status, body };
  }

  const parse = createSseParser(onEvent);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
    }
  } catch {
    throw combined.aborted ? abortReason() : { code: 'NETWORK', body: { code: 'NETWORK' } };
  }
}
