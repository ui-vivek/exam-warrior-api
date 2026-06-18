/**
 * importQuestionsSupplement.js
 * Imports the supplemental question batch (Quant/Reasoning topped up to 200 per
 * subject + verified GK) into MongoDB. Native nested-bilingual model — no
 * transformation needed.
 *
 * Idempotent upsert keyed on (questionText.en, examType, topic), mirroring the
 * model's unique compound index, so re-running UPDATES instead of erroring.
 *
 *   node scripts/importQuestionsSupplement.js                 # imports questions_supplement.json
 *   node scripts/importQuestionsSupplement.js questions_full.json   # or the full 2439-question file
 *
 * Run from the `server` directory.
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const FILE = process.argv[2] || 'questions_supplement.json';

const MultilingualString = { en: { type: String, trim: true }, hi: { type: String, trim: true } };
const QuestionSchema = new mongoose.Schema({
  examType:   { type: String, enum: ['SSC', 'RAILWAY', 'BANKING', 'UPSC'], required: true },
  subject:    { type: String, required: true },
  topic:      { type: String, required: true },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
  questionText: MultilingualString,
  options: { a: MultilingualString, b: MultilingualString, c: MultilingualString, d: MultilingualString },
  correctOption: { type: String, enum: ['a', 'b', 'c', 'd'], required: true },
  explanation: MultilingualString,
  source:     { type: String, default: 'AI' },
  isActive:   { type: Boolean, default: true },
  generationDate: { type: Date, default: Date.now },
  version:    { type: Number, default: 1 },
}, { timestamps: true });

const Question = mongoose.models.Question || mongoose.model('Question', QuestionSchema);

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Set MONGODB_URI (or MONGO_URI) in server/.env');

  await mongoose.connect(uri);
  const raw = fs.readFileSync(path.join(__dirname, FILE), 'utf8');
  const questions = JSON.parse(raw);
  console.log(`Loaded ${questions.length} questions from ${FILE}`);

  const ops = questions.map((q) => ({
    updateOne: {
      filter: { 'questionText.en': q.questionText.en, examType: q.examType, topic: q.topic },
      update: { $set: q },
      upsert: true,
    },
  }));

  const result = await Question.bulkWrite(ops, { ordered: false });
  console.log('Done.');
  console.log(`- Inserted: ${result.upsertedCount}`);
  console.log(`- Updated:  ${result.modifiedCount}`);
  console.log(`- Total questions now: ${await Question.countDocuments({})}`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
