import mongoose from 'mongoose';

/**
 * A push-notification device registered to a user — one document per device.
 *
 * Keyed by a stable per-install `deviceId` (survives token rotation), with the
 * current `deviceToken` (FCM/APNs) stored alongside. This flat shape is optimal
 * for push at scale: tokens are easy to look up, reassign, and clean up, and
 * broadcasts can stream tokens directly. Also doubles as device/session
 * tracking via `lastSeenAt` + `deviceType` + `appVersion`.
 */
const UserDeviceSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Stable identifier for this app install (does NOT change when the push
  // token rotates). One row per (user, deviceId).
  deviceId:    { type: String, required: true },
  deviceType:  { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
  // The push token (FCM/APNs). May rotate over time; can be empty until granted.
  deviceToken: { type: String },
  appVersion:  { type: String },
  lastSeenAt:  { type: Date, default: Date.now },
}, { timestamps: true });

// One device row per (user, install).
UserDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
// Fast lookups: a user's devices, and reverse lookups by token (send/cleanup).
UserDeviceSchema.index({ userId: 1 });
UserDeviceSchema.index({ deviceToken: 1 });

export const UserDevice = mongoose.model('UserDevice', UserDeviceSchema);
