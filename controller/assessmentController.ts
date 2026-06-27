import { Response } from 'express';
import mongoose from 'mongoose';
import { Assessment } from '@/model/assessment.model';
import { AssessmentAttempt } from '@/model/assessmentAttempt.model';
import { Question } from '@/model/question.model';
import { Batch } from '@/model/batch.model';
import { Membership } from '@/model/membership.model';
import { User } from '@/model/user.model';
import { Bookmark } from '@/model/bookmark.model';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';
import {
  SECONDS_PER_QUESTION,
  pickLang,
  phaseOf,
  seededShuffle,
  isAdminOfBatch,
  assertBatchAdmin,
  assertActiveMember,
  buildPaper,
  rankAttempts,
  serializeAssessment,
} from '@/services/assessmentService';

const oid = (v: any) => mongoose.isValidObjectId(v);
const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const seedFor = (userId: string, assessmentId: any) => `${userId}:${assessmentId}`;

const loadAssessment = async (id: any) => {
  if (!oid(id)) throw new AppError('assessment_not_found', 404);
  const a: any = await Assessment.findById(id);
  if (!a) throw new AppError('assessment_not_found', 404);
  return a;
};

// ───────────────────────────── Admin ─────────────────────────────────────────

/** POST /assessments — schedule a shared paper for a batch. */
export const createAssessment = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  const b = req.body as any;
  const batch: any = await assertBatchAdmin(b.batchId, userId);

  const start = new Date(b.windowStart);
  const end = new Date(b.windowEnd);
  if (end <= start) throw new AppError('invalid_window', 400, 'INVALID_WINDOW');
  if (end <= new Date()) throw new AppError('window_in_past', 400, 'WINDOW_IN_PAST');

  const questionIds = await buildPaper({
    examType: batch.examType,
    subjects: b.subjects,
    difficulty: b.difficulty,
    count: b.questionCount,
  });
  if (questionIds.length === 0) throw new AppError('no_questions_found', 404, 'NO_QUESTIONS');

  const total = questionIds.length;
  const durationSec = b.durationMinutes ? b.durationMinutes * 60 : total * SECONDS_PER_QUESTION;

  const a: any = await Assessment.create({
    instituteId: batch.instituteId,
    batchId: batch._id,
    title: b.title,
    type: b.type || 'WEEKLY',
    examType: batch.examType,
    subjects: b.subjects || [],
    difficulty: b.difficulty || 'mixed',
    questionIds,
    totalQuestions: total,
    durationSec,
    windowStart: start,
    windowEnd: end,
    createdBy: userId,
  } as any);

  res.status(201).json({
    success: true,
    // total may be < requested if the bank is thin for the chosen filters.
    data: { assessment: serializeAssessment(a), requested: b.questionCount, built: total },
  });
});

/** GET /assessments/batch/:batchId — assessments for a batch (admin or member). */
export const listBatchAssessments = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  const batchId = String(req.params.batchId || '');
  if (!oid(batchId)) throw new AppError('batch_not_found', 404);
  const batch: any = await Batch.findById(batchId);
  if (!batch) throw new AppError('batch_not_found', 404);

  const admin = await isAdminOfBatch(batch, userId);
  if (!admin) await assertActiveMember(batchId, userId);

  const q: any = { batchId };
  if (!admin) q.status = { $ne: 'CANCELLED' };
  const list: any[] = await Assessment.find(q).sort({ windowStart: -1 }).limit(50);

  // My attempt status (for members), keyed by assessment id.
  const myAttempts = await AssessmentAttempt.find({
    userId,
    assessmentId: { $in: list.map((a) => a._id) },
  }).select('assessmentId status score').lean();
  const mine = new Map(myAttempts.map((m: any) => [m.assessmentId.toString(), m]));

  const assessments = await Promise.all(
    list.map(async (a) => {
      const base = serializeAssessment(a);
      if (admin) {
        const submitted = await AssessmentAttempt.countDocuments({
          assessmentId: a._id, status: { $in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
        });
        return { ...base, submittedCount: submitted };
      }
      const m: any = mine.get(a._id.toString());
      return { ...base, myStatus: m ? m.status : 'NOT_STARTED', myScore: m ? m.score : null };
    }),
  );

  res.json({ success: true, data: { isAdmin: admin, assessments } });
});

/** GET /assessments/:id — detail (admin gets stats, member gets own status). */
export const getAssessment = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  const a = await loadAssessment(req.params.id);
  const batch: any = await Batch.findById(a.batchId);
  const admin = await isAdminOfBatch(batch, userId);
  if (!admin) await assertActiveMember(a.batchId, userId);

  const base = serializeAssessment(a);
  if (admin) {
    const [submitted, memberCount] = await Promise.all([
      AssessmentAttempt.countDocuments({ assessmentId: a._id, status: { $in: ['SUBMITTED', 'AUTO_SUBMITTED'] } }),
      Membership.countDocuments({ batchId: a.batchId, status: 'ACTIVE' }),
    ]);
    return res.json({ success: true, data: { assessment: base, isAdmin: true, stats: { submitted, memberCount } } });
  }

  const m: any = await AssessmentAttempt.findOne({ assessmentId: a._id, userId }).lean();
  res.json({
    success: true,
    data: {
      assessment: base,
      isAdmin: false,
      myAttempt: m ? { status: m.status, score: m.score } : { status: 'NOT_STARTED', score: null },
    },
  });
});

/** POST /assessments/:id/cancel — admin cancels a not-yet-closed assessment. */
export const cancelAssessment = asyncHandler(async (req: LangRequest, res: Response) => {
  const a = await loadAssessment(req.params.id);
  await assertBatchAdmin(a.batchId, req.userId);
  if (a.status === 'CLOSED') throw new AppError('already_closed', 409, 'ALREADY_CLOSED');
  a.status = 'CANCELLED';
  await a.save();
  res.json({ success: true, data: { id: a._id, status: a.status } });
});

/** GET /assessments/:id/analytics — admin: participation, avg, weak topics, top/bottom. */
export const getAssessmentAnalytics = asyncHandler(async (req: LangRequest, res: Response) => {
  const a = await loadAssessment(req.params.id);
  await assertBatchAdmin(a.batchId, req.userId);

  const attempts: any[] = await AssessmentAttempt.find({
    assessmentId: a._id, status: { $in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
  }).lean();
  const memberCount = await Membership.countDocuments({ batchId: a.batchId, status: 'ACTIVE' });

  const participated = attempts.length;
  const sumScore = attempts.reduce((s, x) => s + (x.score || 0), 0);
  const avgScore = participated ? round(sumScore / participated, 1) : 0;
  const avgAccuracy = a.totalQuestions ? round((avgScore / a.totalQuestions) * 100, 1) : 0;

  // Weak topics across the batch — from the attempts' per-question answers.
  const meta: any[] = await Question.find({ _id: { $in: a.questionIds } }).select('subject topic').lean();
  const metaMap = new Map(meta.map((q: any) => [q._id.toString(), q]));
  const agg: Record<string, { attempted: number; wrong: number }> = {};
  for (const at of attempts) {
    for (const ans of at.answers || []) {
      const q = metaMap.get(ans.questionId?.toString());
      if (!q) continue;
      const key = q.subject || q.topic || 'General';
      (agg[key] ||= { attempted: 0, wrong: 0 }).attempted++;
      if (!ans.isCorrect) agg[key].wrong++;
    }
  }
  const weakTopics = Object.entries(agg)
    .map(([subject, v]) => ({ subject, accuracyPct: v.attempted ? round((1 - v.wrong / v.attempted) * 100, 1) : 0, attempted: v.attempted }))
    .sort((x, y) => x.accuracyPct - y.accuracyPct)
    .slice(0, 5);

  const ranked = rankAttempts(attempts);
  const nameScore = (x: any) => ({ name: x.name || 'Student', score: x.score ?? 0 });

  res.json({
    success: true,
    data: {
      memberCount,
      participated,
      completionPct: memberCount ? round((participated / memberCount) * 100) : 0,
      avgScore,
      avgAccuracy,
      totalQuestions: a.totalQuestions,
      weakTopics,
      topPerformers: ranked.slice(0, 3).map(nameScore),
      lowPerformers: ranked.slice(-3).reverse().map(nameScore),
    },
  });
});

// ───────────────────────────── Student ───────────────────────────────────────

/** POST /assessments/:id/start — begin (or resume) the attempt; returns the paper. */
export const startAssessment = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId!;
  const lang = req.lang || 'en';
  const a = await loadAssessment(req.params.id);
  await assertActiveMember(a.batchId, userId);

  const phase = phaseOf(a);
  if (phase === 'upcoming') throw new AppError('not_started_yet', 403, 'NOT_STARTED_YET');
  if (phase !== 'live') throw new AppError('assessment_closed', 403, 'ASSESSMENT_CLOSED');

  let attempt: any = await AssessmentAttempt.findOne({ assessmentId: a._id, userId });
  if (attempt && (attempt.status === 'SUBMITTED' || attempt.status === 'AUTO_SUBMITTED')) {
    throw new AppError('already_submitted', 409, 'ALREADY_SUBMITTED');
  }
  if (!attempt) {
    const user: any = await User.findById(userId).select('name').lean();
    try {
      attempt = await AssessmentAttempt.create({
        assessmentId: a._id,
        batchId: a.batchId,
        instituteId: a.instituteId,
        userId,
        name: user?.name || 'Student',
        totalQuestions: a.totalQuestions,
        startedAt: new Date(),
        status: 'IN_PROGRESS',
      } as any);
    } catch (e: any) {
      // Lost a create race — fetch the row the other request inserted.
      attempt = await AssessmentAttempt.findOne({ assessmentId: a._id, userId });
      if (!attempt) throw e;
    }
  }

  // Per-student question order (stable across resume), no answers leaked.
  const order = seededShuffle((a.questionIds || []).map((q: any) => q.toString()), seedFor(userId, a._id));
  const questions: any[] = await Question.find({ _id: { $in: a.questionIds } })
    .select('-correctOption -explanation')
    .lean();
  const qMap = new Map(questions.map((q: any) => [q._id.toString(), q]));
  const data = order
    .map((qid) => {
      const q = qMap.get(qid);
      if (!q) return null;
      return {
        _id: q._id,
        questionText: pickLang(q.questionText, lang),
        optionA: pickLang(q.options?.a, lang),
        optionB: pickLang(q.options?.b, lang),
        optionC: pickLang(q.options?.c, lang),
        optionD: pickLang(q.options?.d, lang),
        subject: q.subject,
        topic: q.topic,
      };
    })
    .filter(Boolean);

  // Attempt timer ends at the earlier of (start + duration) and the window end.
  const startedMs = new Date(attempt.startedAt).getTime();
  const endsAt = new Date(Math.min(new Date(a.windowEnd).getTime(), startedMs + a.durationSec * 1000));
  const remainingSec = Math.max(0, Math.floor((endsAt.getTime() - Date.now()) / 1000));

  res.json({
    success: true,
    data: {
      assessmentId: a._id,
      title: a.title,
      totalQuestions: a.totalQuestions,
      durationSec: a.durationSec,
      endsAt,
      remainingSec,
      questions: data,
    },
  });
});

/** POST /assessments/:id/submit — score the attempt server-side (one attempt). */
export const submitAssessment = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId!;
  const a = await loadAssessment(req.params.id);
  await assertActiveMember(a.batchId, userId);

  const attempt: any = await AssessmentAttempt.findOne({ assessmentId: a._id, userId });
  if (!attempt) throw new AppError('not_started', 400, 'NOT_STARTED');
  if (attempt.status !== 'IN_PROGRESS') {
    return res.json({ success: true, data: { score: attempt.score, total: a.totalQuestions } });
  }

  // Window enforcement (server time). If it closed mid-attempt, lock them out.
  if (new Date() > new Date(a.windowEnd)) {
    attempt.status = 'AUTO_SUBMITTED';
    attempt.score = 0;
    attempt.submittedAt = new Date();
    await attempt.save();
    throw new AppError('window_closed', 403, 'WINDOW_CLOSED');
  }

  const { answers = [], timeTakenSec } = req.body as {
    answers: { questionId: string; selectedOption?: string }[];
    timeTakenSec?: number;
  };

  const paper = new Set((a.questionIds || []).map((q: any) => q.toString()));
  const qs: any[] = await Question.find({ _id: { $in: a.questionIds } }).select('correctOption').lean();
  const correctMap: Record<string, string> = {};
  qs.forEach((q: any) => { correctMap[q._id.toString()] = String(q.correctOption || '').toLowerCase(); });

  let correct = 0;
  const recorded: any[] = [];
  for (const ans of answers) {
    if (!ans || !ans.questionId || !paper.has(String(ans.questionId))) continue;
    const sel = String(ans.selectedOption || '').toLowerCase();
    const isCorrect = !!correctMap[String(ans.questionId)] && sel === correctMap[String(ans.questionId)];
    if (isCorrect) correct++;
    recorded.push({ questionId: ans.questionId, selectedOption: sel || undefined, isCorrect });
  }

  // Time: trust server elapsed, capped by the attempt duration.
  const serverElapsed = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
  const taken = Math.max(0, Math.min(timeTakenSec ?? serverElapsed, a.durationSec || serverElapsed));

  const updated: any = await AssessmentAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'IN_PROGRESS' },
    {
      $set: {
        answers: recorded,
        score: correct,
        correctCount: correct,
        totalQuestions: a.totalQuestions,
        timeTakenSec: taken,
        submittedAt: new Date(),
        status: 'SUBMITTED',
      },
    },
    { new: true },
  );
  if (!updated) {
    const fresh: any = await AssessmentAttempt.findOne({ assessmentId: a._id, userId });
    return res.json({ success: true, data: { score: fresh?.score ?? correct, total: a.totalQuestions } });
  }

  res.json({
    success: true,
    data: { score: correct, correctCount: correct, total: a.totalQuestions, timeTakenSec: taken },
  });
});

/** GET /assessments/:id/leaderboard — ranked, locked until the window closes. */
export const getAssessmentLeaderboard = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId!;
  const a = await loadAssessment(req.params.id);
  const batch: any = await Batch.findById(a.batchId);
  const admin = await isAdminOfBatch(batch, userId);
  if (!admin) await assertActiveMember(a.batchId, userId);

  const phase = phaseOf(a);
  const attempts: any[] = await AssessmentAttempt.find({
    assessmentId: a._id, status: { $in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
  }).lean();

  // Students don't see the ranking until the window closes; admins always can.
  const locked = a.resultsLockedUntilClose && phase !== 'closed' && !admin;
  if (locked) {
    const me = attempts.find((x) => x.userId.toString() === userId);
    return res.json({
      success: true,
      data: { locked: true, phase, totalQuestions: a.totalQuestions, myScore: me ? me.score : null },
    });
  }

  const leaderboard = rankAttempts(attempts).map((x, i) => ({
    rank: i + 1,
    name: x.name || 'Student',       // name + rank + score only — never phone
    score: x.score ?? 0,
    correctCount: x.correctCount ?? 0,
    timeTakenSec: x.timeTakenSec ?? 0,
    isMe: x.userId.toString() === userId,
  }));

  res.json({ success: true, data: { locked: false, phase, totalQuestions: a.totalQuestions, leaderboard } });
});

/** GET /assessments/:id/review — the caller's own attempt with answers + explanations. */
export const getAssessmentReview = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId!;
  const lang = req.lang || 'en';
  const a = await loadAssessment(req.params.id);
  await assertActiveMember(a.batchId, userId);

  const attempt: any = await AssessmentAttempt.findOne({ assessmentId: a._id, userId });
  if (!attempt || attempt.status === 'IN_PROGRESS') throw new AppError('not_submitted', 409, 'NOT_SUBMITTED');

  const questions: any[] = await Question.find({ _id: { $in: a.questionIds } }).lean();
  const qById = new Map(questions.map((q: any) => [q._id.toString(), q]));

  const answerMap: Record<string, any> = {};
  (attempt.answers || []).forEach((x: any) => { if (x.questionId) answerMap[x.questionId.toString()] = x; });

  const bookmarks = await Bookmark.find({ userId, questionId: { $in: a.questionIds } }).select('questionId').lean();
  const bookmarked = new Set(bookmarks.map((b: any) => b.questionId.toString()));

  // Same per-student order they saw while attempting.
  const order = seededShuffle((a.questionIds || []).map((q: any) => q.toString()), seedFor(userId, a._id));
  const data = order
    .map((qid) => {
      const q = qById.get(qid);
      if (!q) return null;
      const mine = answerMap[q._id.toString()];
      return {
        questionId: q._id,
        questionText: pickLang(q.questionText, lang),
        optionA: pickLang(q.options?.a, lang),
        optionB: pickLang(q.options?.b, lang),
        optionC: pickLang(q.options?.c, lang),
        optionD: pickLang(q.options?.d, lang),
        correctOption: q.correctOption,
        explanationHindi: pickLang(q.explanation, lang),
        subject: q.subject,
        topic: q.topic,
        selectedOption: mine?.selectedOption ?? null,
        isCorrect: mine?.isCorrect ?? false,
        isBookmarked: bookmarked.has(q._id.toString()),
      };
    })
    .filter(Boolean);

  res.json({ success: true, data });
});
