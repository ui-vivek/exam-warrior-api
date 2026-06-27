import mongoose from 'mongoose';

// A batch is a cohort INSIDE an institute that students actually join.
// ONE batch = ONE exam type — this keeps leaderboards fair (never rank an SSC
// student against a Banking one) and lets a coaching that teaches several exams
// just create several batches (no special "multi-subject" mode needed).
//
// `joinCode` mirrors the Room model's join-by-code pattern (uppercase, no
// ambiguous characters) so students join a batch the same way they join a
// classroom battle.
const BatchSchema = new mongoose.Schema({
  instituteId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },
  examType:         { type: String, enum: ['SSC', 'RAILWAY', 'BANKING', 'UPSC', 'AGNIVEER'], required: true },
  name:             { type: String, required: true, trim: true },
  joinCode:         { type: String, required: true, unique: true, uppercase: true },
  // Owner can close joins (e.g. seats full / admissions over) without deleting.
  joinOpen:         { type: Boolean, default: true },
  // When true, new joins land as PENDING and need admin approval.
  requiresApproval: { type: Boolean, default: true },
}, { timestamps: true });

BatchSchema.index({ joinCode: 1 }, { unique: true });

export const Batch = mongoose.model('Batch', BatchSchema);
