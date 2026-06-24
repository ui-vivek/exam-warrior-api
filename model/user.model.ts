import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  phone:                { type: String, required: true, unique: true },
  name:                 { type: String },
  examType:             { type: String, enum: ['SSC','RAILWAY','BANKING','UPSC','AGNIVEER'], default: 'SSC' },
  subscriptionStatus:   { type: String, enum: ['trial','active','expired'], default: 'trial' },
  trialStartDate:       { type: Date, default: Date.now },
  subscriptionEndDate:  { type: Date },
  razorpayCustomerId:   { type: String },
  razorpaySubId:        { type: String },
  subscriptionId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  streakCount:          { type: Number, default: 0 },
  lastActiveDate:       { type: Date },
  refreshToken:         { type: String },
  // Language the QUESTIONS / options / explanations are served in.
  preferredLanguage:    { type: String, enum: ['english', 'hindi'], default: 'english' },
  // Language of the APP INTERFACE (labels, buttons). Independent of the above —
  // e.g. English UI with Hindi questions, or Hindi for both.
  appLanguage:          { type: String, enum: ['english', 'hindi'], default: 'english' },
  state:                { type: String },
  avatar:               { type: String, default: 'aspirant' },
  // Daily rank snapshot used to show day-over-day rank movement on the
  // leaderboard. Updated lazily whenever the user fetches the leaderboard.
  rankTrack: {
    dateKey:        { type: String },   // 'YYYY-MM-DD' of the latest recording
    allIndiaToday:  { type: Number },   // today's all-India rank
    allIndiaPrev:   { type: Number },   // previous day's all-India rank (baseline)
    stateToday:     { type: Number },   // today's state rank
    statePrev:      { type: Number },   // previous day's state rank (baseline)
  },
  // Last all-India rank we PUSHED to this user (rank-movement notification).
  // Separate from rankTrack (which powers the in-app day-over-day display) so
  // the two cadences don't interfere. Compared on the weekly rank-movement job.
  lastNotifiedRank:     { type: Number },
  // Daily room-creation (host) quota counter. Resets when dateKey rolls over
  // (IST). A stored counter, not a count of Room docs — robust to the 6h room
  // TTL deletion that would otherwise let users exceed the daily limit.
  roomCreateTrack: {
    dateKey: { type: String },          // 'YYYY-MM-DD' (IST)
    count:   { type: Number, default: 0 },
  },
  // --- Referral ---
  // Every user gets a short, shareable code generated on first login. `sparse`
  // so legacy rows without a code don't collide on the unique index (they get
  // one lazily when they open the Refer & Earn screen).
  referralCode:         { type: String, unique: true, sparse: true },
  // The user who referred this account (set once, at signup, from their code).
  referredBy:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // INTERNAL accounting only — never surfaced to the user. Total premium days
  // ever granted to this account from referral rewards. Used to enforce a
  // silent lifetime cap (REFERRAL_LIFETIME_CAP_DAYS) so the reward economy
  // can't run away, while the user keeps inviting freely.
  referralRewardDays:   { type: Number, default: 0 },
}, { timestamps: true });

export const User = mongoose.model('User', UserSchema);
