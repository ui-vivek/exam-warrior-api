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
  streakCount:          { type: Number, default: 0 },
  lastActiveDate:       { type: Date },
}, { timestamps: true });

export const User = mongoose.model('User', UserSchema);
