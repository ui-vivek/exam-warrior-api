import mongoose from 'mongoose';

const OtpStoreSchema = new mongoose.Schema({
  phone:      { type: String, required: true },
  otpHash:    { type: String, required: true },  // bcrypt hash of OTP
  attempts:   { type: Number, default: 0 },
  lockedUntil: { type: Date },                 // Lockout timestamp
  expiresAt:  { type: Date, required: true },     // 10 minutes from creation
  createdAt:  { type: Date, default: Date.now, expires: 3600 }, // auto-delete after 1 hour (to support rate limit)
});

// Hot auth path: every send/verify looks up by phone (lockout check, hourly
// rate-limit count, attempt increment). Without this index those are collection
// scans over the continuously TTL-churned OTP collection.
OtpStoreSchema.index({ phone: 1, createdAt: -1 });

export const OtpStore = mongoose.model('OtpStore', OtpStoreSchema);
