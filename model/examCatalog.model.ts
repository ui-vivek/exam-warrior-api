import mongoose from 'mongoose';

/**
 * Canonical exam syllabus: which subjects (and topics under each) belong to a
 * given exam type. Drives the practice setup chips and constrains the daily
 * test, so users only ever see subjects/topics that are actually part of their
 * exam.
 *
 * One document per { examType, subject }. This keeps queries simple now and
 * makes a future admin panel a plain CRUD over this collection — no re-modeling.
 */
const ExamCatalogSchema = new mongoose.Schema(
  {
    examType: {
      type: String,
      enum: ['SSC', 'RAILWAY', 'BANKING', 'UPSC'],
      required: true,
    },
    subject: { type: String, required: true, trim: true },
    topics: [{ type: String, trim: true }],
    // Display order of the subject within the exam (lower = first).
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// A subject appears once per exam type.
ExamCatalogSchema.index({ examType: 1, subject: 1 }, { unique: true });

export const ExamCatalog = mongoose.model('ExamCatalog', ExamCatalogSchema);
