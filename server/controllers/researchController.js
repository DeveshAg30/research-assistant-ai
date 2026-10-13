const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');
const ResearchReport = require('../models/ResearchReport');
const ResearchSession = require('../models/ResearchSession');
const HttpError = require('../utils/httpError');

const { VERIFICATION_STATUSES } = ResearchReport;

function assertObjectId(id, what = 'report') {
  if (!mongoose.isValidObjectId(id)) {
    throw new HttpError(400, 'VALIDATION', `Invalid ${what} id.`);
  }
}

async function findOwnedReport(id, userId) {
  assertObjectId(id);
  const report = await ResearchReport.findOne({ _id: id, user: userId });
  if (!report) throw new HttpError(404, 'NOT_FOUND', 'Research report not found.');
  return report;
}

/**
 * GET /api/history?page=1&limit=10&status=CONFIRMED&search=polar+bears&bookmarked=true
 * status: ALL | one of VERIFICATION_STATUSES | FAILED (failed or cancelled runs)
 */
const getHistory = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const { status, search, bookmarked } = req.query;

  const filter = { user: req.user.id };

  if (status === 'FAILED') {
    filter.status = { $in: ['failed', 'cancelled'] };
  } else if (VERIFICATION_STATUSES.includes(status)) {
    filter.verification_status = status;
  }

  if (bookmarked === 'true') {
    filter.is_bookmarked = true;
  }

  if (typeof search === 'string' && search.trim()) {
    filter.$text = { $search: search.trim() };
  }

  const [items, total] = await Promise.all([
    ResearchReport.find(filter)
      .select('-intermediate_steps -internal_sources -web_sources -output') // list view only
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

/** GET /api/history/:id */
const getReportById = asyncHandler(async (req, res) => {
  res.json(await findOwnedReport(req.params.id, req.user.id));
});

/** PATCH /api/history/:id/bookmark -- toggles is_bookmarked. */
const toggleBookmark = asyncHandler(async (req, res) => {
  const report = await findOwnedReport(req.params.id, req.user.id);
  report.is_bookmarked = !report.is_bookmarked;
  await report.save();
  res.json(report);
});

/** GET /api/sessions/:id -- the whole thread, oldest first. */
const getSession = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'session');
  const session = await ResearchSession.findOne({ _id: req.params.id, user: req.user.id });
  if (!session) throw new HttpError(404, 'NOT_FOUND', 'Research session not found.');
  const reports = await ResearchReport.find({ session: session._id, user: req.user.id }).sort({
    createdAt: 1,
  });
  res.json({ session, reports });
});

module.exports = {
  getHistory,
  getReportById,
  toggleBookmark,
  getSession,
};
