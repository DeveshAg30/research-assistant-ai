import { describe, expect, it, vi } from 'vitest';
import { createSseParser, streamQuery } from './stream';
import { setToken } from './client';

function sseResponse(frames, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      frames.forEach((f) => controller.enqueue(encoder.encode(f)));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('createSseParser', () => {
  it('handles frames split across chunks and multiple frames per chunk', () => {
    const events = [];
    const parse = createSseParser((e, d) => events.push([e, d]));
    parse('event: token\ndata: {"te');
    parse('xt":"Hi"}\n\nevent: claims\ndata: {"claims":["a"]}\n\nevent: fin');
    parse('al\ndata: {"ok":true}\n\n');
    expect(events).toEqual([
      ['token', { text: 'Hi' }],
      ['claims', { claims: ['a'] }],
      ['final', { ok: true }],
    ]);
  });
});

describe('streamQuery', () => {
  it('sends the token and session, and dispatches events', async () => {
    setToken('jwt-123');
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse(['event: report\ndata: {"report":{"_id":"r1"}}\n\n', 'event: final\ndata: {"report":{"_id":"r1"}}\n\n'])
    );
    const events = [];
    await streamQuery({ query: 'q', sessionId: 's1', fetchImpl, onEvent: (e) => events.push(e) });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt-123');
    expect(JSON.parse(init.body)).toEqual({ query: 'q', sessionId: 's1' });
    expect(events).toEqual(['report', 'final']);
  });

  it('rejects with the server error body for non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'QUOTA_EXCEEDED', error: 'Out of quota' }), { status: 429 })
    );
    await expect(streamQuery({ query: 'q', fetchImpl, onEvent: () => {} })).rejects.toMatchObject({
      status: 429,
      body: { code: 'QUOTA_EXCEEDED' },
    });
  });

  it('reports CANCELLED when the caller aborts', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((url, init) => {
      controller.abort();
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError', signal: init.signal }));
    });
    await expect(
      streamQuery({ query: 'q', signal: controller.signal, fetchImpl, onEvent: () => {} })
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('reports NETWORK when the server is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(streamQuery({ query: 'q', fetchImpl, onEvent: () => {} })).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
