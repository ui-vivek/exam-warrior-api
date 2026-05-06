import mongoose from 'mongoose';

const TestAnswerSchema = new mongoose.Schema({
  testId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
  questionId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  selectedOption:  { type: String, enum: ['a','b','c','d'] },
  isCorrect:       { type: Boolean },
  timeSpentSec:    { type: Number },
});

// TestAnswers — fast lookup by test
TestAnswerSchema.index({ testId: 1 });

export const TestAnswer = mongoose.model('TestAnswer', TestAnswerSchema);
