import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  phone:                { type: String, required: true, unique: true },
  name:                 { type: String },
  examType:             { type: String, enum: ['SSC','RAILWAY','BANKING','UPSC'], default: 'SSC' },
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
}, { timestamps: true });

export const User = mongoose.model('User', UserSchema);
