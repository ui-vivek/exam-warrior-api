import mongoose from 'mongoose';

// One student's attempt at one assessment. Separate collection (not embedded in
// the assessment) so a batch of hundreds doesn't bloat a single document and so
// the unique (assessment, user) index enforces ONE attempt per student.
const AttemptAnswerSchema = new mongoose.Schema({
  questionId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
  selectedOption: { type: String },
  isCorrect:      { type: Boolean },
}, { _id: false });

const AssessmentAttemptSchema = new mongoose.Schema({
  assessmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true },
  batchId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  instituteId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Institute', required: true },
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:         { type: String, default: 'Student' },

  answers:        [AttemptAnswerSchema],   // kept for per-question review
  score:          { type: Number, default: null },   // null until submitted
  correctCount:   { type: Number, default: 0 },
  totalQuestions: { type: Number, default: 0 },
  timeTakenSec:   { type: Number, default: 0 },

  startedAt:   { type: Date },
  submittedAt: { type: Date },
  // AUTO_SUBMITTED = the window closed before they submitted (finalizer).
  status: { type: String, enum: ['IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED'], default: 'IN_PROGRESS' },
}, { timestamps: true });

// One attempt per (assessment, user).
AssessmentAttemptSchema.index({ assessmentId: 1, userId: 1 }, { unique: true });
// Leaderboard ordering + "my attempts" lookups.
AssessmentAttemptSchema.index({ assessmentId: 1, score: -1 });
AssessmentAttemptSchema.index({ batchId: 1, userId: 1 });

export const AssessmentAttempt = mongoose.model('AssessmentAttempt', AssessmentAttemptSchema);
