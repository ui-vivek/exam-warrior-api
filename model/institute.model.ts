import mongoose from 'mongoose';

// An institute is the org an owner manages: a library, coaching centre, or a
// YouTube teacher's batch. ONE entity with a `type` field — never separate
// products. Students keep their own personal account; institute membership is
// only an extra layer on top (see membership.model.ts).
//
// Staff (owner + optional teachers) is an embedded list so a coaching with
// multiple teachers can be modelled without a separate collection. v1 treats
// every staff member as a full admin; per-batch teacher scoping comes later.
const InstituteStaffSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:   { type: String, enum: ['OWNER', 'TEACHER', 'STAFF'], default: 'TEACHER' },
}, { _id: false });

const InstituteSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name:    { type: String, required: true, trim: true },
  type:    { type: String, enum: ['LIBRARY', 'COACHING', 'YOUTUBE', 'SCHOOL', 'OTHER'], default: 'COACHING' },

  // Branding (Growth+ in the plan, but stored from the start so it's a toggle).
  logoUrl:    { type: String },
  bannerUrl:  { type: String },
  brandColor: { type: String },

  // Plan + capacity. Seats count UNIQUE active students per institute, not
  // memberships — a student in both the SSC and Banking batch uses one seat.
  // Detailed billing (cycle dates, Razorpay refs) lands with the payment phase.
  plan:       { type: String, enum: ['FREE', 'STARTER', 'GROWTH', 'PRO'], default: 'FREE' },
  seatsTotal: { type: Number, default: 25 },
  status:     { type: String, enum: ['ACTIVE', 'PAST_DUE', 'SUSPENDED'], default: 'ACTIVE' },

  staff: [InstituteStaffSchema],
}, { timestamps: true });

export const Institute = mongoose.model('Institute', InstituteSchema);
