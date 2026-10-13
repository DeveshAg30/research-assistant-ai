const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One ResearchReport document = one query/response cycle. Reports belong
 * to a user and to a ResearchSession (the conversation thread).
 *
 * Lifecycle: `running` (created when the stream starts) -> `completed`,
 * `failed` (with error_code / error_message) or `cancelled` (the client
 * disconnected). `verification_status` is only set on completed reports.
 */

const InternalSourceSchema = new Schema(
  {
    id: { type: String, default: '' },
    organisation: { type: String, default: '' },
    claim: { type: String, default: '' },
    original_verdict: { type: String, default: '' },
    date_published: { type: String, default: '' },
    url: { type: String, default: '' },
    normalised_rating: { type: String, default: '' },
    article_id: { type: String, default: '' },
    score: { type: Number, default: null },
    title: { type: String, default: '' },
    cited: { type: Boolean, default: false },
  },
  { _id: false }
);

const WebSourceSchema = new Schema(
  {
    id: { type: String, default: '' },
    title: { type: String, default: '' },
    domain: { type: String, default: '' },
    url: { type: String, default: '' },
    published: { type: String, default: '' },
    snippet: { type: String, default: '' },
    cited: { type: Boolean, default: false },
  },
  { _id: false }
);

const IntermediateStepSchema = new Schema(
  {
    tool: { type: String, default: '' },
    tool_input: { type: Schema.Types.Mixed },
    log: { type: String, default: '' },
    observation: { type: String, default: '' },
  },
  { _id: false }
);

const VERIFICATION_STATUSES = [
  'CONFIRMED',
  'UPDATED',
  'CONTRADICTED',
  'INSUFFICIENT',
  'INTERNAL_ONLY',
];

const REPORT_STATUSES = ['running', 'completed', 'failed', 'cancelled'];

const ClaimSchema = new Schema(
  {
    text: { type: String, default: '' },
    status: { type: String, enum: VERIFICATION_STATUSES },
    confidence: { type: Number, default: null },
  },
  { _id: false }
);

const ResearchReportSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    session: { type: Schema.Types.ObjectId, ref: 'ResearchSession', index: true },
    query: {
      type: String,
      required: [true, 'query is required'],
      trim: true,
      maxlength: 2000,
    },
    output: { type: String, default: '' },
    verification_status: {
      type: String,
      enum: [...VERIFICATION_STATUSES, null],
      default: null,
      index: true,
    },
    self_reported_status: { type: String, enum: [...VERIFICATION_STATUSES, null], default: null },
    status_flags: { type: [String], default: [] },
    confidence: { type: Number, default: null },
    confidence_breakdown: { type: Schema.Types.Mixed, default: null },
    claims: { type: [ClaimSchema], default: [] },
    tools_used: { type: [String], default: [] },
    internal_sources: { type: [InternalSourceSchema], default: [] },
    web_sources: { type: [WebSourceSchema], default: [] },
    intermediate_steps: { type: [IntermediateStepSchema], default: [] },
    is_bookmarked: { type: Boolean, default: false, index: true },
    status: { type: String, enum: REPORT_STATUSES, default: 'running', index: true },
    error_code: { type: String, default: '' },
    error_message: { type: String, default: '' },
    usage: {
      input_tokens: { type: Number, default: 0 },
      output_tokens: { type: Number, default: 0 },
      web_searches: { type: Number, default: 0 },
      tool_calls: { type: Number, default: 0 },
    },
    latency_ms: { type: Number, default: null },
    request_id: { type: String, default: '' },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
  }
);

// Per-user history, newest first.
ResearchReportSchema.index({ user: 1, createdAt: -1 });

// Full-text search over the query and answer, scoped to one user (every
// $text query must include an equality match on `user`).
ResearchReportSchema.index({ user: 1, query: 'text', output: 'text' });

module.exports = mongoose.model('ResearchReport', ResearchReportSchema);
module.exports.VERIFICATION_STATUSES = VERIFICATION_STATUSES;
module.exports.REPORT_STATUSES = REPORT_STATUSES;
