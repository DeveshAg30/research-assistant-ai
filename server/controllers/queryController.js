const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const ResearchReport = require('../models/ResearchReport');
const ResearchSession = require('../models/ResearchSession');
const settings = require('../config/settings');
const HttpError = require('../utils/httpError');
const logger = require('../utils/logger');
const { researchQueries } = require('../utils/metrics');
const { streamResearch } = require('../services/aiClient');
const { reserveQuery, recordUsage } = require('../services/usage');
const { writeSse } = require('../services/sse');

// AI-service events relayed to the browser as-is ('final' and 'error' are
// replaced by our own, which carry the persisted report).
const RELAYED_EVENTS = new Set(['start', 'claims', 'tool_start', 'tool_end', 'token']);

function validateQuery(body = {}) {
  const { query, sessionId } = body;
  if (typeof query !== 'string' || !query.trim()) {
    throw new HttpError(400, 'VALIDATION', 'Request body must include a non-empty "query" string.');
  }
  const trimmed = query.trim();
  if (trimmed.length > settings.MAX_QUERY_LENGTH) {
    throw new HttpError(
      400,
      'QUERY_TOO_LONG',
      `Queries are limited to ${settings.MAX_QUERY_LENGTH} characters (yours has ${trimmed.length}).`
    );
  }
  if (sessionId != null && !mongoose.isValidObjectId(sessionId)) {
    throw new HttpError(400, 'VALIDATION', 'Invalid session id.');
  }
  return { query: trimmed, sessionId: sessionId || null };
}

/** The session's last N completed turns, oldest first, as chat messages. */
async function buildChatHistory(sessionId, userId) {
  const previous = await ResearchReport.find({ session: sessionId, user: userId, status: 'completed' })
    .sort({ createdAt: -1 })
    .limit(settings.HISTORY_TURNS)
    .select('query output')
    .lean();
  const clip = (text) => String(text || '').slice(0, settings.HISTORY_TURN_CHARS);
  return previous.reverse().flatMap((r) => [
    { role: 'user', content: clip(r.query) },
    { role: 'assistant', content: clip(r.output) },
  ]);
}

const RESULT_FIELDS = [
  'output',
  'verification_status',
  'self_reported_status',
  'status_flags',
  'confidence',
  'confidence_breakdown',
  'claims',
  'tools_used',
  'internal_sources',
  'web_sources',
  'intermediate_steps',
  'usage',
  'latency_ms',
];

/**
 * POST /api/query/stream  { query, sessionId? }
 *
 * Responds with text/event-stream:
 *   report      {report}        -- the new `running` report (ids for the client)
 *   start|claims|tool_start|tool_end|token  -- relayed live from the agent
 *   final       {report}        -- the saved, completed report
 *   error       {error, code, detail, report, requestId}
 *
 * Validation, auth, rate-limit and quota failures happen before the
 * stream opens and are ordinary JSON errors.
 */
const streamQuery = asyncHandler(async (req, res) => {
  const { query, sessionId } = validateQuery(req.body);
  const userId = req.user.id;

  let session;
  if (sessionId) {
    session = await ResearchSession.findOne({ _id: sessionId, user: userId });
    if (!session) throw new HttpError(404, 'NOT_FOUND', 'Research session not found.');
  }

  // Runs older than the upstream timeout can't still be live (e.g. orphaned
  // by a restart), so they don't block new queries.
  const liveSince = new Date(Date.now() - settings.AI_SERVICE_TIMEOUT_MS - 30000);
  if (await ResearchReport.exists({ user: userId, status: 'running', createdAt: { $gt: liveSince } })) {
    throw new HttpError(
      429,
      'CONCURRENT_RUN',
      'You already have a research query running. Wait for it to finish or cancel it.'
    );
  }
  await reserveQuery(userId);

  const chatHistory = session ? await buildChatHistory(session._id, userId) : [];
  if (!session) {
    session = await ResearchSession.create({ user: userId, title: query.slice(0, 200) });
  }

  const report = await ResearchReport.create({
    user: userId,
    session: session._id,
    query,
    status: 'running',
    request_id: req.id,
  });

  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  writeSse(res, 'report', { report });

  // Note: `req` 'close' fires once the body is read; the response's
  // 'close' before it has ended is the reliable "client went away" signal.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const result = await streamResearch({
      query,
      chatHistory,
      requestId: req.id,
      signal: controller.signal,
      onEvent: (event, data) => {
        if (RELAYED_EVENTS.has(event)) writeSse(res, event, data);
      },
    });

    for (const field of RESULT_FIELDS) {
      if (result[field] !== undefined) report.set(field, result[field]);
    }
    report.status = 'completed';
    await report.save();
    await recordUsage(userId, result.usage).catch((err) =>
      logger.error({ err, requestId: req.id }, 'Failed to record usage')
    );
    researchQueries.labels('completed').inc();
    writeSse(res, 'final', { report });
  } catch (err) {
    const cancelled = err.code === 'CANCELLED';
    report.status = cancelled ? 'cancelled' : 'failed';
    report.error_code = err.code || 'AGENT_ERROR';
    report.error_message = cancelled ? 'Cancelled by the user.' : String(err.detail || err.message);
    await report.save().catch((saveErr) =>
      logger.error({ err: saveErr, requestId: req.id }, 'Failed to save failed report')
    );
    researchQueries.labels(cancelled ? 'cancelled' : report.error_code).inc();
    logger.warn({ requestId: req.id, code: report.error_code, detail: err.detail }, 'Research run did not complete');
    writeSse(res, 'error', {
      error: err.message,
      code: report.error_code,
      detail: err.detail,
      report,
      requestId: req.id,
    });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

/** On startup: runs interrupted by a server restart can never finish. */
async function sweepStaleRuns() {
  const cutoff = new Date(Date.now() - settings.STALE_RUN_MS);
  const { modifiedCount } = await ResearchReport.updateMany(
    { status: 'running', createdAt: { $lt: cutoff } },
    {
      $set: {
        status: 'failed',
        error_code: 'INTERRUPTED',
        error_message: 'This research run was interrupted (the server restarted). Please retry.',
      },
    }
  );
  return modifiedCount;
}

module.exports = { streamQuery, sweepStaleRuns };
