import mongoose from 'mongoose';

const QuestionSchema = new mongoose.Schema({
  examType:         { type: String, enum: ['SSC','RAILWAY','BANKING','UPSC'], required: true },
  subject:          { type: String, required: true },  // Reasoning, Math, GK, English, Hindi
  topic:            { type: String, required: true },  // e.g. "Number Series"
  difficulty:       { type: String, enum: ['easy','medium','hard'], default: 'medium' },
  questionText:     { type: String, required: true, trim: true },
  optionA:          { type: String, required: true },
  optionB:          { type: String, required: true },
  optionC:          { type: String, required: true },
  optionD:          { type: String, required: true },
  correctOption:    { type: String, enum: ['a','b','c','d'], required: true },
  explanationHindi: { type: String },
  source:           { type: String, default: 'AI' },   // 'AI' or 'PYQ'
  aiVerified:       { type: Boolean, default: false },
  reportedWrong:    { type: Boolean, default: false },
  reportCount:      { type: Number, default: 0 },
  isActive:         { type: Boolean, default: true },
  generationDate:   { type: Date, default: Date.now },
  generationVersion:{ type: String, default: 'v1' },
  performance: {
    generationTimeMs: { type: Number },
    verificationTimeMs: { type: Number }
  }
}, { timestamps: true });

// Compound Unique Index: Same question allowed in different exams, but not twice in the same context.
QuestionSchema.index({ questionText: 1, examType: 1, topic: 1 }, { unique: true });

// Questions — fast lookup by exam type + topic
QuestionSchema.index({ examType: 1, topic: 1, isActive: 1 });
QuestionSchema.index({ examType: 1, generationDate: 1 });

export const Question = mongoose.model('Question', QuestionSchema);
