const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One ResearchReport document = one query/response cycle.
 *
 * Design note: the original spec mentioned separate `ResearchSession` and
 * `QueryRecord` schemas. Since each query here is self-contained (there is
 * no multi-turn conversational state carried between queries), they've been
 * consolidated into this single document per the `ResearchReport.js`
 * deliverable filename. If multi-turn "sessions" (several related queries
 * grouped together) are needed later, add a parent `ResearchSession` model
 * with a `session_id` ref on this schema.
 */

const InternalSourceSchema = new Schema(
  {
    organisation: { type: String, default: '' },
    claim: { type: String, default: '' },
    original_verdict: { type: String, default: '' },
    date_published: { type: String, default: '' },
    url: { type: String, default: '' },
    normalised_rating: { type: String, default: '' },
    title: { type: String, default: '' },
  },
  { _id: false }
);

const WebSourceSchema = new Schema(
  {
    title: { type: String, default: '' },
    domain: { type: String, default: '' },
    url: { type: String, default: '' },
    snippet: { type: String, default: '' },
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

const ResearchReportSchema = new Schema(
  {
    query: {
      type: String,
      required: [true, 'query is required'],
      trim: true,
      maxlength: 2000,
    },
    output: {
      type: String,
      default: '',
    },
    verification_status: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: 'INSUFFICIENT',
      index: true,
    },
    tools_used: {
      type: [String],
      default: [],
    },
    internal_sources: {
      type: [InternalSourceSchema],
      default: [],
    },
    web_sources: {
      type: [WebSourceSchema],
      default: [],
    },
    intermediate_steps: {
      type: [IntermediateStepSchema],
      default: [],
    },
    is_bookmarked: {
      type: Boolean,
      default: false,
      index: true,
    },
    status: {
      type: String,
      enum: ['completed', 'failed'],
      default: 'completed',
      index: true,
    },
    error_message: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
  }
);

// Full-text search over the query and answer, used by GET /api/history?search=
ResearchReportSchema.index({ query: 'text', output: 'text' });

// Common list-view sort: newest first.
ResearchReportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ResearchReport', ResearchReportSchema);
module.exports.VERIFICATION_STATUSES = VERIFICATION_STATUSES;
