import mongoose from 'mongoose';

const OtpStoreSchema = new mongoose.Schema({
  phone:      { type: String, required: true },
  otpHash:    { type: String, required: true },  // bcrypt hash of OTP
  attempts:   { type: Number, default: 0 },
  lockedUntil: { type: Date },                 // Lockout timestamp
  expiresAt:  { type: Date, required: true },     // 10 minutes from creation
  createdAt:  { type: Date, default: Date.now, expires: 3600 }, // auto-delete after 1 hour (to support rate limit)
});

export const OtpStore = mongoose.model('OtpStore', OtpStoreSchema);
