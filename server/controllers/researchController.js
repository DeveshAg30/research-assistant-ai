const axios = require('axios');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const ResearchReport = require('../models/ResearchReport');

const RAW_AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
// Render's private-network reference (fromService.hostport) is a bare
// "host:port", so default to http:// when no scheme is given.
const AI_SERVICE_URL = /^https?:\/\//.test(RAW_AI_SERVICE_URL)
  ? RAW_AI_SERVICE_URL
  : `http://${RAW_AI_SERVICE_URL}`;
// The agent can genuinely take a while (retrieval + possibly a live web
// search + LLM synthesis), so give it a generous timeout rather than
// failing fast on a slow-but-successful run.
const AI_SERVICE_TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS || 120000);

/**
 * POST /api/query
 * Forwards the query to the Python AI microservice, persists the full
 * result (or the failure) to MongoDB, and returns the saved record.
 */
const submitQuery = asyncHandler(async (req, res) => {
  const { query } = req.body;

  if (!query || typeof query !== 'string' || !query.trim()) {
    res.status(400);
    throw new Error('Request body must include a non-empty "query" string.');
  }

  let aiResponse;
  try {
    const { data } = await axios.post(
      `${AI_SERVICE_URL}/api/research`,
      { query: query.trim() },
      { timeout: AI_SERVICE_TIMEOUT_MS }
    );
    aiResponse = data;
  } catch (err) {
    const detail =
      err.response?.data?.detail || err.message || 'Unknown AI service error';

    // Persist the failure too, so it shows up in history instead of
    // silently vanishing -- useful for debugging and for the user to retry.
    const failedReport = await ResearchReport.create({
      query: query.trim(),
      status: 'failed',
      error_message: String(detail),
    });

    res.status(err.response ? 502 : 504);
    return res.json({
      error: 'AI service request failed.',
      detail,
      reportId: failedReport._id,
    });
  }

  const report = await ResearchReport.create({
    query: query.trim(),
    output: aiResponse.output,
    verification_status: aiResponse.verification_status,
    tools_used: aiResponse.tools_used,
    internal_sources: aiResponse.internal_sources,
    web_sources: aiResponse.web_sources,
    intermediate_steps: aiResponse.intermediate_steps,
    status: 'completed',
  });

  res.status(201).json(report);
});

/**
 * GET /api/history?page=1&limit=10&status=CONFIRMED&search=polar+bears&bookmarked=true
 */
const getHistory = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const { status, search, bookmarked } = req.query;

  const filter = {};

  if (status && status !== 'ALL') {
    filter.verification_status = status;
  }

  if (bookmarked === 'true') {
    filter.is_bookmarked = true;
  }

  if (search && search.trim()) {
    filter.$text = { $search: search.trim() };
  }

  const [items, total] = await Promise.all([
    ResearchReport.find(filter)
      .select('-intermediate_steps') // list view doesn't need the full trace
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    ResearchReport.countDocuments(filter),
  ]);

  res.json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  });
});

/**
 * GET /api/history/:id
 */
const getReportById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid report id.');
  }

  const report = await ResearchReport.findById(id);

  if (!report) {
    res.status(404);
    throw new Error('Research report not found.');
  }

  res.json(report);
});

/**
 * PATCH /api/history/:id/bookmark
 * Toggles is_bookmarked.
 */
const toggleBookmark = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid report id.');
  }

  const report = await ResearchReport.findById(id);

  if (!report) {
    res.status(404);
    throw new Error('Research report not found.');
  }

  report.is_bookmarked = !report.is_bookmarked;
  await report.save();

  res.json(report);
});

module.exports = {
  submitQuery,
  getHistory,
  getReportById,
  toggleBookmark,
};
