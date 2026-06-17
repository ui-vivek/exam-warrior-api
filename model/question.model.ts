import mongoose from 'mongoose';

const MultilingualString = {
  en: { type: String, trim: true },
  hi: { type: String, trim: true }
};

const QuestionSchema = new mongoose.Schema({
  examType:         { type: String, enum: ['SSC','RAILWAY','BANKING','UPSC'], required: true },
  subject:          { type: String, required: true },
  topic:            { type: String, required: true },
  difficulty:       { type: String, enum: ['easy','medium','hard'], default: 'medium' },
  
  // Multilingual content
  questionText:     MultilingualString,
  options: {
    a: MultilingualString,
    b: MultilingualString,
    c: MultilingualString,
    d: MultilingualString
  },
  
  correctOption:    { type: String, enum: ['a','b','c','d'], required: true },
  explanation:      MultilingualString,
  
  source:           { type: String, default: 'AI' },
  isActive:         { type: Boolean, default: true },
  generationDate:   { type: Date, default: Date.now },
  version:          { type: Number, default: 1 },
  generationVersion:{ type: String, default: 'v1' },
  performance: {
    generationTimeMs: { type: Number },
    verificationTimeMs: { type: Number }
  },
  // "Report wrong question" safeguard. These were being written by the report
  // endpoint but were absent from the schema, so strict mode silently dropped
  // them. Declaring them makes the report button actually persist.
  reportCount:      { type: Number, default: 0 },
  reportedWrong:    { type: Boolean, default: false }
}, { timestamps: true });

// Compound Unique Index: Same question allowed in different exams, but not twice in the same context.
QuestionSchema.index({ questionText: 1, examType: 1, topic: 1 }, { unique: true });

// Questions — fast lookup by exam type + topic
QuestionSchema.index({ examType: 1, topic: 1, isActive: 1 });
QuestionSchema.index({ examType: 1, generationDate: 1 });

export const Question = mongoose.model('Question', QuestionSchema);
