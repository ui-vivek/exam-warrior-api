import mongoose from 'mongoose';
import { Question } from '@/model/question.model';
import { Institute } from '@/model/institute.model';
import { Batch } from '@/model/batch.model';
import { Membership } from '@/model/membership.model';
import { Assessment } from '@/model/assessment.model';
import { AssessmentAttempt } from '@/model/assessmentAttempt.model';
import { AppError } from '@/utils/AppError';

// Mirrors the Room engine's default pacing; override for quick local testing.
export const SECONDS_PER_QUESTION = Number(process.env.ASSESSMENT_SECONDS_PER_QUESTION) || 60;

// Same bilingual field reader the test/room controllers use.
export const pickLang = (field: any, lang: string): string =>
  field?.[lang] || field?.en || field?.hi || '';

// ── derived phase ─────────────────────────────────────────────────────────────
export type Phase = 'upcoming' | 'live' | 'closed' | 'cancelled';
export const phaseOf = (a: any, now = new Date()): Phase => {
  if (a.status === 'CANCELLED') return 'cancelled';
  if (a.status === 'CLOSED') return 'closed';
  if (now < new Date(a.windowStart)) return 'upcoming';
  if (now > new Date(a.windowEnd)) return 'closed';
  return 'live';
};

// ── deterministic per-student shuffle (mulberry32) ────────────────────────────
// Same paper for everyone, but each student sees a different question order so an
// answer SEQUENCE (a,c,b,d…) can't be copied. Seeded by user+assessment so the
// order is stable across re-fetch / resume.
const hashSeed = (s: string): number => {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
};
const mulberry32 = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const seededShuffle = <T>(arr: T[], seed: string): T[] => {
  const rand = mulberry32(hashSeed(seed));
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ── authorization helpers ─────────────────────────────────────────────────────
export const isAdminOfBatch = async (batch: any, userId?: string): Promise<boolean> => {
  if (!userId) return false;
  const inst: any = await Institute.findById(batch.instituteId);
  if (!inst) return false;
  return (
    inst.ownerId.toString() === userId ||
    (inst.staff || []).some((s: any) => s.userId.toString() === userId)
  );
};

/** Loads a batch and asserts the caller may administer its institute. */
export const assertBatchAdmin = async (batchId: any, userId?: string) => {
  if (!userId) throw new AppError('unauthorized', 401);
  if (!mongoose.isValidObjectId(batchId)) throw new AppError('batch_not_found', 404);
  const batch: any = await Batch.findById(batchId);
  if (!batch) throw new AppError('batch_not_found', 404);
  if (!(await isAdminOfBatch(batch, userId))) throw new AppError('forbidden', 403);
  return batch;
};

/** Asserts the caller is an ACTIVE member of the batch. */
export const assertActiveMember = async (batchId: any, userId?: string) => {
  if (!userId) throw new AppError('unauthorized', 401);
  const ok = await Membership.exists({ batchId, userId, status: 'ACTIVE' });
  if (!ok) throw new AppError('not_a_member', 403, 'NOT_A_MEMBER');
};

// ── paper builder ─────────────────────────────────────────────────────────────
/** Samples a frozen question set for the assessment from the question bank. */
export const buildPaper = async (opts: {
  examType: string;
  subjects?: string[];
  difficulty?: string;
  count: number;
}): Promise<mongoose.Types.ObjectId[]> => {
  const match: any = { examTypes: opts.examType, isActive: true };
  if (opts.subjects && opts.subjects.length) {
    match.$or = [{ subject: { $in: opts.subjects } }, { topic: { $in: opts.subjects } }];
  }
  if (opts.difficulty && opts.difficulty !== 'mixed') match.difficulty = opts.difficulty;

  const rows = await Question.aggregate([{ $match: match }, { $sample: { size: opts.count } }]);
  return rows.map((q: any) => q._id);
};

// ── ranking (tie-breaks) ──────────────────────────────────────────────────────
// score DESC → correctCount DESC → timeTaken ASC → submittedAt ASC.
export const rankAttempts = (attempts: any[]): any[] =>
  [...attempts].sort((a, b) => {
    if ((b.score ?? -1) !== (a.score ?? -1)) return (b.score ?? -1) - (a.score ?? -1);
    if ((b.correctCount ?? 0) !== (a.correctCount ?? 0)) return (b.correctCount ?? 0) - (a.correctCount ?? 0);
    if ((a.timeTakenSec ?? Infinity) !== (b.timeTakenSec ?? Infinity)) return (a.timeTakenSec ?? Infinity) - (b.timeTakenSec ?? Infinity);
    const at = a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity;
    const bt = b.submittedAt ? new Date(b.submittedAt).getTime() : Infinity;
    return at - bt;
  });

// ── serializers ───────────────────────────────────────────────────────────────
export const serializeAssessment = (a: any, now = new Date()) => ({
  id: a._id,
  batchId: a.batchId,
  title: a.title,
  type: a.type,
  examType: a.examType,
  subjects: a.subjects || [],
  difficulty: a.difficulty,
  totalQuestions: a.totalQuestions,
  durationSec: a.durationSec,
  windowStart: a.windowStart,
  windowEnd: a.windowEnd,
  status: a.status,
  phase: phaseOf(a, now),
});

// ── finalizer (cron) ──────────────────────────────────────────────────────────
/**
 * Closes assessments whose window has elapsed and auto-submits any attempts that
 * were started but never submitted (scoring whatever was recorded, else 0).
 * Index-backed ({status, windowEnd}); cheap to run every minute.
 */
export const finalizeClosedAssessments = async () => {
  const now = new Date();
  const due = await Assessment.find({ status: 'SCHEDULED', windowEnd: { $lte: now } })
    .select('_id')
    .lean();

  let closed = 0;
  let autoSubmitted = 0;
  for (const a of due as any[]) {
    const flip = await Assessment.updateOne(
      { _id: a._id, status: 'SCHEDULED', windowEnd: { $lte: now } },
      { $set: { status: 'CLOSED' } },
    );
    if (flip.modifiedCount !== 1) continue;
    closed += 1;

    const res = await AssessmentAttempt.updateMany(
      { assessmentId: a._id, status: 'IN_PROGRESS' },
      { $set: { status: 'AUTO_SUBMITTED', score: 0, submittedAt: now } },
    );
    autoSubmitted += res.modifiedCount || 0;
  }

  return { closed, autoSubmitted };
};
