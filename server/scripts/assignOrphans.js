/**
 * Assigns reports created before auth existed (no `user`) to one account,
 * each in its own session, so they show up in that user's history.
 *
 *   node scripts/assignOrphans.js --email you@example.com
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const ResearchReport = require('../models/ResearchReport');
const ResearchSession = require('../models/ResearchSession');

async function main() {
  const emailIndex = process.argv.indexOf('--email');
  const email = emailIndex > -1 ? process.argv[emailIndex + 1] : null;
  if (!email) throw new Error('Usage: node scripts/assignOrphans.js --email you@example.com');

  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error(`No user with email ${email}; register first.`);

  const orphans = await ResearchReport.collection.find({ user: { $exists: false } }).toArray();
  for (const report of orphans) {
    const session = await ResearchSession.create({ user: user._id, title: String(report.query).slice(0, 200) });
    const legacyStatus = report.status === 'failed' ? 'failed' : 'completed';
    await ResearchReport.collection.updateOne(
      { _id: report._id },
      { $set: { user: user._id, session: session._id, status: legacyStatus } }
    );
  }
  console.log(`Assigned ${orphans.length} report(s) to ${user.email}.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
