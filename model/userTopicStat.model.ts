import mongoose from 'mongoose';

const UserTopicStatSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject:         { type: String, required: true },
  topic:           { type: String, required: true },
  totalAttempted:  { type: Number, default: 0 },
  totalCorrect:    { type: Number, default: 0 },
  accuracyPct:     { type: Number, default: 0 },
  lastAttemptedAt: { type: Date, default: Date.now },
});

// Unique: one stat row per user per topic
UserTopicStatSchema.index({ userId: 1, subject: 1, topic: 1 }, { unique: true });
// UserTopicStats — sorted weak topics
UserTopicStatSchema.index({ userId: 1, accuracyPct: 1 });

export const UserTopicStat = mongoose.model('UserTopicStat', UserTopicStatSchema);
