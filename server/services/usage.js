const mongoose = require('mongoose');
const UsageDaily = require('../models/UsageDaily');
const settings = require('../config/settings');
const HttpError = require('../utils/httpError');

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Atomically count one query against a daily limit. The `queries < limit`
 * filter plus the unique (user, day) index means a full bucket makes the
 * upsert collide (E11000) instead of incrementing past the limit.
 */
async function reserve(user, limit) {
  try {
    await UsageDaily.findOneAndUpdate(
      { user, day: today(), queries: { $lt: limit } },
      { $inc: { queries: 1 } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
}

/** Throws 429 QUOTA_EXCEEDED if the user or the whole service is out of quota. */
async function reserveQuery(userId) {
  const userObjectId = new mongoose.Types.ObjectId(userId);
  if (!(await reserve(null, settings.DAILY_GLOBAL_QUERY_LIMIT))) {
    throw new HttpError(429, 'QUOTA_EXCEEDED', 'The service has reached its daily research limit. Please try again tomorrow.');
  }
  if (!(await reserve(userObjectId, settings.DAILY_QUERY_LIMIT))) {
    await UsageDaily.updateOne({ user: null, day: today() }, { $inc: { queries: -1 } });
    throw new HttpError(
      429,
      'QUOTA_EXCEEDED',
      `You have used all ${settings.DAILY_QUERY_LIMIT} research queries for today. The limit resets at midnight UTC.`
    );
  }
}

/** Add token / tool usage from a finished run to today's counters. */
async function recordUsage(userId, usage = {}) {
  const inc = {
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    web_searches: usage.web_searches || 0,
  };
  const day = today();
  await Promise.all([
    UsageDaily.updateOne({ user: new mongoose.Types.ObjectId(userId), day }, { $inc: inc }, { upsert: true }),
    UsageDaily.updateOne({ user: null, day }, { $inc: inc }, { upsert: true }),
  ]);
}

async function getTodayUsage(userId) {
  const doc = await UsageDaily.findOne({ user: new mongoose.Types.ObjectId(userId), day: today() }).lean();
  return { queries: doc?.queries || 0, limit: settings.DAILY_QUERY_LIMIT };
}

module.exports = { reserveQuery, recordUsage, getTodayUsage };
