import mongoose from 'mongoose';

const TestSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The exam this test belongs to — all stats/history/ranking are scoped by it,
  // so switching exams keeps each exam's progress separate (and reversible).
  examType:        { type: String, enum: ['SSC','RAILWAY','BANKING','UPSC','AGNIVEER'], default: 'SSC' },
  testDate:        { type: String, required: true },   // 'YYYY-MM-DD' format (IST)
  questions:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  answers: [{
    questionId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Question' },
    questionVersion: { type: Number, default: 1 },
    selectedOption:  { type: String },
    isCorrect:       { type: Boolean },
    timeSpentSec:    { type: Number }
  }],
  score:           { type: Number, default: 0 },
  totalQuestions:  { type: Number, default: 20 },
  timeTakenSec:    { type: Number },
  completed:       { type: Boolean, default: false },
  // Last question index the user was on (for resuming an in-progress test).
  currentIndex:    { type: Number, default: 0 },
  // 'daily' = the once-a-day mock test; 'practice' = focused weak-topic drill.
  type:            { type: String, enum: ['daily', 'practice'], default: 'daily' },
  // For practice tests: the subject/topic being drilled.
  subject:         { type: String },
  topic:           { type: String },
}, { timestamps: true });

// Unique: one DAILY test per user per day. Practice tests use a unique
// testDate token (e.g. 'practice-<ts>') so they never collide here.
TestSchema.index({ userId: 1, testDate: 1 }, { unique: true });

// History / stats: list a user's tests newest-first without an in-memory sort.
TestSchema.index({ userId: 1, createdAt: -1 });
// Leaderboard aggregation matches { completed, type } across all users.
TestSchema.index({ completed: 1, type: 1 });

export const Test = mongoose.model('Test', TestSchema);
