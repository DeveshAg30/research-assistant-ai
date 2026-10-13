const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * A conversation thread: the first query plus any follow-ups. Each
 * ResearchReport in the thread references it via `session`, and the
 * earlier turns are sent to the agent as `chat_history`.
 */
const ResearchSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ResearchSession', ResearchSessionSchema);
