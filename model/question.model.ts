import mongoose from 'mongoose';
import crypto from 'crypto';

const MultilingualString = {
  en: { type: String, trim: true },
  hi: { type: String, trim: true }
};

const EXAM_TYPES = ['SSC', 'RAILWAY', 'BANKING', 'UPSC', 'AGNIVEER'];

// Stable, content-derived dedup key: a SHA-1 of the normalised
// (stem | subject | topic). We index THIS fixed ~40-byte string for uniqueness
// instead of the raw question text, which (a) keeps the unique index tiny, (b)
// is immune to MongoDB's 1024-byte index-key limit even for long comprehension
// questions, and (c) the normalisation (lowercase + whitespace removed) also
// collapses near-duplicates like "2+2" vs "2 + 2".
// MUST stay byte-for-byte in sync with scripts/agniveer/importQuestionsAgniveer.js
// and scripts/migrateAddDedupKey.js.
export const computeDedupKey = (en?: string, subject?: string, topic?: string): string =>
  crypto
    .createHash('sha1')
    .update([en, subject, topic].map((s) => String(s || '').toLowerCase().replace(/\s+/g, '')).join('|'))
    .digest('hex');

const QuestionSchema = new mongoose.Schema({
  // A question can belong to MANY exams — e.g. a Profit & Loss question is asked
  // in SSC, Railway and Banking. Storing the membership as an array means ONE
  // canonical question is reused across exams instead of being duplicated per
  // exam. Query with `{ examTypes: 'SSC' }` — a multikey match that hits any doc
  // whose array contains that exam.
  examTypes: {
    type: [String],
    enum: EXAM_TYPES,
    required: true,
    validate: {
      validator: (v: string[]) => Array.isArray(v) && v.length > 0,
      message: 'examTypes must list at least one exam',
    },
  },
  // DEPRECATED single-exam field. Kept (optional) only so a zero-downtime
  // migration can backfill `examTypes` while older code still reads `examType`.
  // The pre-validate hook below keeps it mirrored. Safe to remove once
  // scripts/migrateExamTypesToArray.js has run in every environment.
  examType:         { type: String, enum: EXAM_TYPES },
  // Content-derived unique key (see computeDedupKey). Auto-set by the
  // pre-validate hook on save()/insertMany(); the import scripts (bulkWrite,
  // which skips hooks) set it explicitly. Unique-indexed below.
  dedupKey:         { type: String, required: true },
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
  // Set true once the AI-validation layer confirms the answer is correct.
  // Written by aiController on save; declared here so strict mode persists it.
  aiVerified:       { type: Boolean, default: false },
  // "Report wrong question" safeguard. These were being written by the report
  // endpoint but were absent from the schema, so strict mode silently dropped
  // them. Declaring them makes the report button actually persist.
  reportCount:      { type: Number, default: 0 },
  reportedWrong:    { type: Boolean, default: false }
}, { timestamps: true });

// Compound Unique Index: Same question allowed in different exams, but not twice
// in the same context. Index the ENGLISH stem (`questionText.en`) — a scalar
// string — rather than the whole `{ en, hi }` object. Indexing the embedded
// object put BOTH languages (incl. multi-byte Devanagari) into one key, which
// risked exceeding MongoDB's ~1024-byte index-key limit and rejecting inserts,
// and made uniqueness depend on the full object instead of the question text.
// NOTE: the old `{ questionText: 1, examType: 1, topic: 1 }` index must be
// dropped once in each environment (autoIndex creates new indexes but never
// drops old ones) — see scripts/dropLegacyQuestionIndex.ts.
// Uniqueness is enforced on the hashed `dedupKey` (a fixed ~40-byte digest of
// stem|subject|topic) — small, immune to the 1024-byte index-key limit, and it
// collapses near-duplicates. Exam membership lives in `examTypes`, so a question
// shared across exams is ONE document. The older `{ questionText.en, ... }`
// unique index is dropped by scripts/migrateAddDedupKey.js.
QuestionSchema.index({ dedupKey: 1 }, { unique: true });

// Eligibility lookups by exam (multikey over the array) + topic.
QuestionSchema.index({ examTypes: 1, topic: 1, isActive: 1 });
QuestionSchema.index({ examTypes: 1, generationDate: 1 });

// Back-compat normaliser: lift a legacy single `examType` into `examTypes`, and
// keep the legacy mirror in sync so any not-yet-updated reader still works.
// Runs on save() and insertMany(); bulkWrite upserts bypass document middleware,
// so the import scripts set `examTypes` directly.
(QuestionSchema as any).pre('validate', function (this: any, next: (err?: any) => void) {
  const doc: any = this;
  if ((!doc.examTypes || doc.examTypes.length === 0) && doc.examType) {
    doc.examTypes = [doc.examType];
  }
  if (Array.isArray(doc.examTypes) && doc.examTypes.length && !doc.examType) {
    doc.examType = doc.examTypes[0];
  }
  // Always (re)derive the dedup key from current content.
  doc.dedupKey = computeDedupKey(doc.questionText?.en, doc.subject, doc.topic);
  next();
});

export const Question = mongoose.model('Question', QuestionSchema);
