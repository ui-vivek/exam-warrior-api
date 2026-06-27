import mongoose from 'mongoose';

// An institute assessment is a SCHEDULED, SHARED paper for a whole batch — the
// thing that makes a fair head-to-head leaderboard possible (unlike the
// personal adaptive daily test, where everyone gets different questions).
//
// It builds on the proven Classroom Battle (Room) mechanic — a frozen question
// set scored server-side — but is batch-scoped, scheduled into a time window,
// and persistent. Attempts live in their own collection (assessmentAttempt)
// rather than embedded, so a batch of hundreds scales cleanly.
const AssessmentSchema = new mongoose.Schema({
  instituteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },
  batchId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },

  title:    { type: String, required: true, trim: true },
  type:     { type: String, enum: ['WEEKLY', 'DAILY', 'ASSIGNMENT'], default: 'WEEKLY' },
  examType: { type: String, enum: ['SSC', 'RAILWAY', 'BANKING', 'UPSC', 'AGNIVEER'], required: true },

  // Selection criteria the admin chose (kept for record + analytics).
  subjects:   { type: [String], default: [] },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'mixed'], default: 'mixed' },

  // The frozen paper. Same question set for everyone; per-student order is
  // shuffled at fetch time (seeded by user) so answer sequences can't be copied.
  questionIds:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  totalQuestions: { type: Number, default: 0 },
  // Per-attempt timer once a student starts (capped by the window end).
  durationSec:    { type: Number, default: 0 },

  // The shared window — everyone takes within this slot. All checks use SERVER
  // time, never the device clock.
  windowStart: { type: Date, required: true },
  windowEnd:   { type: Date, required: true },
  // Leaderboard + ranks stay hidden until the window closes, so early takers
  // can't leak a live ranking to late takers.
  resultsLockedUntilClose: { type: Boolean, default: true },

  // SCHEDULED until the finalizer (or window end) flips it to CLOSED. "live" is
  // derived from the window, not stored. CANCELLED is set by the admin.
  status:    { type: String, enum: ['SCHEDULED', 'CLOSED', 'CANCELLED'], default: 'SCHEDULED' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

AssessmentSchema.index({ batchId: 1, windowStart: -1 });
// Finalizer scans schedulable assessments whose window has elapsed.
AssessmentSchema.index({ status: 1, windowEnd: 1 });

export const Assessment = mongoose.model('Assessment', AssessmentSchema);
