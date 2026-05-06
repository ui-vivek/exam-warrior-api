import mongoose from 'mongoose';

const QuestionSchema = new mongoose.Schema({
  examType:         { type: String, enum: ['SSC','RAILWAY','BANKING','UPSC'], required: true },
  subject:          { type: String, required: true },  // Reasoning, Math, GK, English, Hindi
  topic:            { type: String, required: true },  // e.g. "Number Series"
  difficulty:       { type: String, enum: ['easy','medium','hard'], default: 'medium' },
  questionText:     { type: String, required: true },
  optionA:          { type: String, required: true },
  optionB:          { type: String, required: true },
  optionC:          { type: String, required: true },
  optionD:          { type: String, required: true },
  correctOption:    { type: String, enum: ['a','b','c','d'], required: true },
  explanationHindi: { type: String },
  source:           { type: String, default: 'AI' },   // 'AI' or 'PYQ'
  isActive:         { type: Boolean, default: true },
  generationDate:   { type: Date, default: Date.now },
}, { timestamps: true });

// Questions — fast lookup by exam type + topic
QuestionSchema.index({ examType: 1, topic: 1, isActive: 1 });
QuestionSchema.index({ examType: 1, generationDate: 1 });

export const Question = mongoose.model('Question', QuestionSchema);
