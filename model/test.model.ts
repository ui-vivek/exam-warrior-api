import mongoose from 'mongoose';

const TestSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  testDate:        { type: String, required: true },   // 'YYYY-MM-DD' format (IST)
  questions:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  score:           { type: Number, default: 0 },
  totalQuestions:  { type: Number, default: 20 },
  timeTakenSec:    { type: Number },
  completed:       { type: Boolean, default: false },
}, { timestamps: true });

// Unique: one test per user per day
TestSchema.index({ userId: 1, testDate: 1 }, { unique: true });

export const Test = mongoose.model('Test', TestSchema);
