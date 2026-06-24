import mongoose from 'mongoose';

/**
 * One document per referred account — the link between a referrer and the friend
 * they brought in. The referee is unique (a person can be referred only once),
 * which also doubles as our primary anti-fraud anchor alongside the verified
 * phone on the User.
 *
 * Lifecycle:
 *  - 'registered': friend signed up with the code but hasn't proven they're a
 *    real student yet (no daily test submitted).
 *  - 'active':     friend submitted their FIRST daily test → reward credited to
 *    both sides (subject to fraud checks + the silent lifetime cap). Terminal.
 *  - 'blocked':    a fraud signal stopped the reward; kept for review. The
 *    friend still counts as joined, they just earn no days.
 */
const ReferralSchema = new mongoose.Schema({
  referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // A person can only ever be referred once — unique guards self-/re-referral.
  refereeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  code:       { type: String, required: true },
  status:     { type: String, enum: ['registered', 'active', 'blocked'], default: 'registered' },
  rewardedAt: { type: Date },
  // Days actually credited to each side AFTER the lifetime cap was applied
  // (may be 0 if the side had already hit the cap — we never expose this).
  rewardDaysReferrer: { type: Number, default: 0 },
  rewardDaysReferee:  { type: Number, default: 0 },
  // Fraud signals captured at signup, re-checked at reward time.
  signupDeviceId:     { type: String },
  signupIp:           { type: String },
  // If the reward was withheld, why — for manual review (not shown to users).
  blockedReason:      { type: String },
}, { timestamps: true });

ReferralSchema.index({ referrerId: 1, status: 1 });

export const Referral = mongoose.model('Referral', ReferralSchema);
