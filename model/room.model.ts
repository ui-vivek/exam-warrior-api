import mongoose from 'mongoose';

const RoomParticipantSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:       { type: String, default: 'Warrior' },
  score:      { type: Number, default: null },   // null until they finish
  finishedAt: { type: Date },
  joinedAt:   { type: Date, default: Date.now },
}, { _id: false });

const RoomSchema = new mongoose.Schema({
  code:        { type: String, required: true, unique: true, uppercase: true },
  hostId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  hostName:    { type: String, default: 'Host' },
  examType:    { type: String, enum: ['SSC','RAILWAY','BANKING','UPSC'], default: 'SSC' },
  status:      { type: String, enum: ['lobby','active','finished'], default: 'lobby' },
  questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  totalQuestions: { type: Number, default: 10 },
  participants: [RoomParticipantSchema],
  startedAt:   { type: Date },
  // Auto-expire idle rooms after 6 hours.
  expiresAt:   { type: Date, default: () => new Date(Date.now() + 6 * 60 * 60 * 1000) },
}, { timestamps: true });

RoomSchema.index({ code: 1 }, { unique: true });
RoomSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// "My rooms" history queries by a participant's userId on the embedded array.
RoomSchema.index({ 'participants.userId': 1 });

export const Room = mongoose.model('Room', RoomSchema);
