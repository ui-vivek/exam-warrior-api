import mongoose from 'mongoose';

const UserTopicStatSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Scoped per exam: the same topic name in two exams keeps separate stats.
  examType:        { type: String, enum: ['SSC','RAILWAY','BANKING','UPSC'], default: 'SSC' },
  subject:         { type: String, required: true },
  topic:           { type: String, required: true },
  totalAttempted:  { type: Number, default: 0 },
  totalCorrect:    { type: Number, default: 0 },
  // Lifetime accuracy (all attempts ever). Stable; used for overall stats.
  accuracyPct:     { type: Number, default: 0 },
  // Recent-weighted accuracy (exponential moving average). Reacts quickly to
  // recent practice so improvement shows fast and old mistakes decay. Drives
  // weak-topic detection and the "mastered" cut-off.
  recentAccuracyPct: { type: Number, default: 0 },
  lastAttemptedAt: { type: Date, default: Date.now },
});

// Unique: one stat row per user per topic PER EXAM (so e.g. SSC History and
// Banking History are tracked separately).
UserTopicStatSchema.index({ userId: 1, examType: 1, subject: 1, topic: 1 }, { unique: true });
// UserTopicStats — sorted weak topics (by recent proficiency, weakest first)
UserTopicStatSchema.index({ userId: 1, recentAccuracyPct: 1 });

export const UserTopicStat = mongoose.model('UserTopicStat', UserTopicStatSchema);
