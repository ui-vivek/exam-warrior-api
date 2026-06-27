import mongoose from 'mongoose';

// Links a student to a batch (and, denormalized, to its institute). The student
// always owns their own User account — this row is just the institute layer on
// top, so removing it never touches the personal account.
//
// A student may have several memberships in the SAME institute (SSC + Banking
// batch); that still counts as ONE seat (seat = unique active user per
// institute), enforced in instituteService.countActiveSeats().
const MembershipSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  batchId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  instituteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Institute', required: true },

  status: { type: String, enum: ['PENDING', 'ACTIVE', 'REMOVED'], default: 'PENDING' },
  source: { type: String, enum: ['CODE', 'MANUAL', 'LINK'], default: 'CODE' },

  joinedAt:   { type: Date, default: Date.now },
  approvedAt: { type: Date },
  removedAt:  { type: Date },
}, { timestamps: true });

// One membership per (user, batch). A re-join flips an existing row's status
// rather than inserting a duplicate.
MembershipSchema.index({ userId: 1, batchId: 1 }, { unique: true });
// Roster + seat-count queries.
MembershipSchema.index({ instituteId: 1, status: 1 });
MembershipSchema.index({ batchId: 1, status: 1 });

export const Membership = mongoose.model('Membership', MembershipSchema);
