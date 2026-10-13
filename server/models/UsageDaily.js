const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Per-user, per-UTC-day usage counters. A document with `user: null`
 * holds the global (all users) counters for the day.
 */
const UsageDailySchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  day: { type: String, required: true }, // YYYY-MM-DD (UTC)
  queries: { type: Number, default: 0 },
  input_tokens: { type: Number, default: 0 },
  output_tokens: { type: Number, default: 0 },
  web_searches: { type: Number, default: 0 },
});

UsageDailySchema.index({ user: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('UsageDaily', UsageDailySchema);
