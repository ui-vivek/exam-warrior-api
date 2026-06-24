import { Request, Response } from 'express';
import { AuthRequest } from '@/middleware/authMiddleware';
import { Test } from '@/model/test.model';
import { Question } from '@/model/question.model';
import { ExamCatalog } from '@/model/examCatalog.model';
import { Bookmark } from '@/model/bookmark.model';
import { UserTopicStat } from '@/model/userTopicStat.model';
import { User } from '@/model/user.model';
import { getTodayIST } from '@/utils/dateHelper';
import { updateTopicStats, updateStreak } from '@/services/analyticsService';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { getMessage } from '@/utils/messages';
import { LangRequest } from '@/middleware/languageMiddleware';

/** Maps a topic accuracy % to a friendly mastery level. */
const masteryLevel = (acc: number): string => {
  if (acc < 50) return 'Weak';
  if (acc < 70) return 'Improving';
  if (acc < 85) return 'Strong';
  return 'Mastered';
};

/**
 * POST /tests/practice  { subject?: string | string[], topic?, difficulty? }
 * Generates a focused 10-question drill for a topic and/or one or more subjects.
 * Marked type:'practice' so it never counts as the daily test / streak.
 */
export const createPracticeTest = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const user = await User.findById(userId);
  if (!user) throw new AppError('user_not_found', 404);

  // `subject` may be a single value or an array (multi-subject drill).
  const rawSubject = req.body.subject;
  const subjects: string[] = (Array.isArray(rawSubject) ? rawSubject : [rawSubject])
    .map((s: any) => String(s || '').trim())
    .filter((s: string) => s.length > 0);
  const subjectFilter = subjects.length ? { subject: { $in: subjects } } : null;
  // `topic` is the legacy single value (weak-topic drills); `topics` is the
  // array picked on the practice screen. Merge both into one list.
  const rawTopics = req.body.topics;
  const topicList: string[] = [
    ...(Array.isArray(rawTopics) ? rawTopics : []),
    req.body.topic,
  ]
    .map((t: any) => String(t || '').trim())
    .filter((t: string) => t.length > 0);
  // 'all' (or empty) means no difficulty filter.
  const rawDifficulty = String(req.body.difficulty || '').trim().toLowerCase();
  const difficulty = ['easy', 'medium', 'hard'].includes(rawDifficulty)
    ? rawDifficulty
    : null;

  const PRACTICE_SIZE = 10;
  const examBase: any = { examTypes: user.examType, isActive: true };

  const sample = (match: any) =>
    Question.aggregate([
      { $match: { ...examBase, ...match } },
      { $sample: { size: PRACTICE_SIZE } },
    ]);

  // Sample within exactly what the user asked for: a topic if given, else the
  // selected subject(s), else (All subjects) the whole exam. We never pad a
  // drill with unrelated topics.
  const scope: any = {};
  if (topicList.length) scope.topic = { $in: topicList };
  else if (subjectFilter) Object.assign(scope, subjectFilter);

  // Prefer the chosen difficulty; if that yields nothing, relax difficulty
  // within the same scope.
  let questions: any[] = await sample({ ...scope, ...(difficulty ? { difficulty } : {}) });
  if (questions.length === 0 && difficulty) {
    questions = await sample(scope);
  }

  // A weak-topic / focus drill targets a single topic AND carries its subject.
  // If that exact topic has no questions of its own yet, fall back to its
  // subject (still related) so the drill loads something relevant rather than
  // dead-ending. Subject-only and "All" drills keep their strict scope.
  if (questions.length === 0 && topicList.length && subjectFilter) {
    questions = await sample(subjectFilter);
  }

  if (questions.length === 0) throw new AppError('no_questions_found', 404);

  // Track improvement against whatever was actually drilled (from the first
  // picked question, before shuffling, so single-topic drills stay accurate).
  const drilledSubject = questions[0].subject || subjects[0] || 'General';
  const drilledTopic = questions[0].topic || topicList[0] || '';

  // Shuffle so a multi-subject / "All" drill interleaves subjects rather than
  // showing them in blocks. (No-op feel for single-topic drills.)
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  let test = await Test.create({
    userId,
    examType: user.examType,
    testDate: `practice-${Date.now()}`,
    type: 'practice',
    subject: drilledSubject,
    topic: drilledTopic,
    questions: questions.map((q: any) => q._id),
    totalQuestions: questions.length,
  });

  test = await test.populate('questions', '-correctOption -explanation');

  const lang = req.lang || 'en';
  const testObj: any = test.toObject();
  // Single source of truth: every question is the nested bilingual model.
  // Pick the requested language; fall back to the other language only if one
  // side is empty (both `en` and `hi` belong to the SAME model).
  const getT = (field: any) => field?.[lang] || field?.en || field?.hi || '';
  testObj.questions = (testObj.questions || [])
    .filter((q: any) => q)
    .map((q: any) => ({
      ...q,
      questionText: getT(q.questionText),
      optionA: getT(q.options?.a),
      optionB: getT(q.options?.b),
      optionC: getT(q.options?.c),
      optionD: getT(q.options?.d),
    }));

  res.json({ success: true, data: testObj });
});

/**
 * GET /tests/practice/subjects
 * Distinct subjects available to drill for the user's exam type — powers the
 * subject chips on the practice setup screen.
 */
export const getPracticeSubjects = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const user = await User.findById(userId).select('examType').lean();
  if (!user) throw new AppError('user_not_found', 404);

  const subjects: string[] = await Question.distinct('subject', {
    examTypes: (user as any).examType,
    isActive: true,
  });

  res.json({
    success: true,
    data: subjects.filter((s) => s && s.trim()).sort(),
  });
});

/** In-syllabus subject names for an exam type (empty if catalog not seeded). */
async function catalogSubjectsFor(examType: string): Promise<string[]> {
  const rows = await ExamCatalog.find({ examType: examType as any, isActive: true })
    .select('subject')
    .lean();
  return rows.map((r: any) => r.subject).filter(Boolean);
}

/**
 * GET /tests/practice/syllabus
 * Returns the in-syllabus subjects (in exam order) and, under each, the topics
 * that actually have questions — so the practice screen only ever shows
 * subjects/topics that belong to the user's exam AND can produce a drill.
 */
export const getPracticeSyllabus = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const user = await User.findById(userId).select('examType').lean();
  if (!user) throw new AppError('user_not_found', 404);
  const examType = (user as any).examType;

  // Canonical syllabus for this exam (ordered).
  const catalog = await ExamCatalog.find({ examType, isActive: true })
    .sort({ order: 1 })
    .lean();

  // What actually has questions, grouped by subject -> set of topics. Used to
  // hide empty chips and to back-fill topics for legacy/untagged data.
  const avail = await Question.aggregate([
    { $match: { examTypes: examType, isActive: true } },
    { $group: { _id: '$subject', topics: { $addToSet: '$topic' } } },
  ]);
  const availMap = new Map<string, Set<string>>(
    avail.map((a: any) => [
      a._id,
      new Set((a.topics || []).filter((t: any) => t && String(t).trim())),
    ])
  );

  const data: { subject: string; topics: string[] }[] = [];
  for (const c of catalog as any[]) {
    const have = availMap.get(c.subject);
    if (!have || have.size === 0) continue; // no questions yet — hide the subject
    // Prefer the canonical topics that exist; if none match (legacy tagging),
    // fall back to whatever topics the questions actually carry.
    let topics = (c.topics || []).filter((t: string) => have.has(t));
    if (topics.length === 0) topics = [...have].sort();
    data.push({ subject: c.subject, topics });
  }

  // Fallback: catalog not seeded for this exam — derive subjects from questions.
  if (data.length === 0) {
    for (const a of avail as any[]) {
      if (a._id) {
        data.push({
          subject: a._id,
          topics: (a.topics || []).filter((t: any) => t && String(t).trim()).sort(),
        });
      }
    }
  }

  res.json({ success: true, data });
});

export const getTodayTest = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  const today = getTodayIST();

  // Everything is scoped to the user's current exam, so switching exams keeps
  // each exam's daily test / lock independent.
  const meDoc = await User.findById(userId).select('examType');
  const examType = (meDoc as any)?.examType || 'SSC';

  // One daily test per day: if today's daily test is already completed, it's
  // locked until tomorrow (practice mode stays unlimited). Resuming an
  // in-progress attempt is still allowed.
  const completedToday = await Test.exists({
    userId,
    examType,
    type: { $ne: 'practice' },
    completed: true,
    testDate: today,
  });

  // Resume an in-progress daily test if one exists; otherwise generate a fresh
  // one below — unless today's test is already done (locked).
  let test = await Test.findOne({ userId, examType, type: { $ne: 'practice' }, completed: false })
    .sort({ createdAt: -1 })
    .populate('questions', '-correctOption -explanation');

  if (!test && completedToday) {
    throw new AppError('daily_already_completed', 409);
  }

  // If test exists, filter out any questions that were deleted from DB (populated as null)
  if (test && test.questions) {
    test.questions = test.questions.filter((q: any) => q !== null);
  }

  // If test exists but questions couldn't be populated (e.g. deleted from DB), re-generate
  if (test && (!test.questions || test.questions.length === 0)) {
    await Test.deleteOne({ _id: test._id });
    test = null;
  }

  if (!test) {
    const user = await User.findById(userId);
    if (!user) throw new AppError('user_not_found', 404);

    // --- Adaptive Learning Logic ---
    // Fetch user's top 3 weak topics (accuracy < 50%, attempted >= 5)
    const weakTopicsData = await UserTopicStat.find({
      userId,
      totalAttempted: { $gte: 5 },
      accuracyPct: { $lt: 50 }
    })
    .sort({ accuracyPct: 1 })
    .limit(3)
    .select('topic');
    
    const weakTopicNames = weakTopicsData.map(t => t.topic);

    // Build a balanced daily MOCK: it should span many subjects (like a real
    // exam) with only a moderate adaptive boost toward the user's weak topics —
    // never dominated by a single topic.
    const DAILY_SIZE = 20;
    const WEAK_BOOST = 6; // ~30% adaptive; the rest is breadth across subjects
    const examBase: any = { examTypes: user.examType, isActive: true };
    // Keep the daily mock within the exam's syllabus: only draw from subjects
    // that belong to this exam type. Guarded so an unseeded catalog doesn't
    // starve the test (falls back to all subjects for the exam type).
    const dailySubjects = await catalogSubjectsFor(user.examType);
    if (dailySubjects.length > 0) examBase.subject = { $in: dailySubjects };
    const questions: any[] = [];
    const pickedIds = () => questions.map((q: any) => q._id);

    // 1. Adaptive slice — a few questions from the user's weak topics (capped
    //    so they can't take over the whole test).
    if (weakTopicNames.length > 0) {
      const weak = await Question.aggregate([
        { $match: { ...examBase, topic: { $in: weakTopicNames } } },
        { $sample: { size: WEAK_BOOST } },
      ]);
      questions.push(...weak);
    }

    // 2. Breadth slice — spread the remainder across the exam's subjects so the
    //    mock covers multiple areas instead of clustering on one.
    if (questions.length < DAILY_SIZE) {
      const subjects: string[] = (await Question.distinct('subject', examBase))
        .filter((s: string) => s && s.trim());
      if (subjects.length > 0) {
        const remaining = DAILY_SIZE - questions.length;
        const perSubject = Math.max(1, Math.ceil(remaining / subjects.length));
        for (const subject of subjects) {
          if (questions.length >= DAILY_SIZE) break;
          const need = Math.min(perSubject, DAILY_SIZE - questions.length);
          const part = await Question.aggregate([
            { $match: { ...examBase, subject, _id: { $nin: pickedIds() } } },
            { $sample: { size: need } },
          ]);
          questions.push(...part);
        }
      }
    }

    // 3. Fallback — top up randomly from anything to reach the target.
    if (questions.length < DAILY_SIZE) {
      const fill = await Question.aggregate([
        { $match: { ...examBase, _id: { $nin: pickedIds() } } },
        { $sample: { size: DAILY_SIZE - questions.length } },
      ]);
      questions.push(...fill);
    }

    if (questions.length === 0) {
      throw new AppError('no_questions_found', 404);
    }

    // Shuffle so the weak-topic and per-subject blocks are interleaved — the
    // test shouldn't open with six of the same topic in a row.
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }

    // One readable date for the first test of the day; extra same-day tests get
    // a unique suffix to satisfy the unique {userId,testDate} index.
    const todayTaken = await Test.exists({ userId, testDate: today });
    const testDate = todayTaken ? `${today}#${Date.now()}` : today;

    test = await Test.create({
      userId,
      examType: user.examType,
      testDate,
      type: 'daily',
      questions: questions.map(q => q._id),
      totalQuestions: questions.length
    });

    test = await test.populate('questions', '-correctOption -explanation');
  }

  const lang = req.lang || 'en';
  const testObj: any = test.toObject();

  if (testObj.questions) {
    testObj.questions = testObj.questions
      .filter((q: any) => q !== null && q !== undefined)
      .map((q: any) => {
        // Pick requested language from the nested bilingual model; the
        // en/hi cross-fallback covers a rare empty side within the same model.
        const getT = (field: any) => field?.[lang] || field?.en || field?.hi || '';

        return {
          ...q,
          questionText: getT(q.questionText),
          optionA: getT(q.options?.a),
          optionB: getT(q.options?.b),
          optionC: getT(q.options?.c),
          optionD: getT(q.options?.d),
          explanation: getT(q.explanation)
        };
      });
  }

  // Saved progress so the app can resume: selected options + last position.
  testObj.savedAnswers = (testObj.answers || [])
    .filter((a: any) => a && a.questionId && a.selectedOption)
    .map((a: any) => ({
      questionId: a.questionId.toString(),
      selectedOption: a.selectedOption,
    }));
  testObj.currentIndex = testObj.currentIndex ?? 0;
  delete testObj.answers; // don't leak the raw answers array

  res.json({ success: true, data: testObj });
});

/**
 * POST /tests/:id/progress  { answers: [{questionId, selectedOption}], currentIndex }
 * Autosaves an in-progress attempt so the user can resume exactly where they
 * left off. Does not grade or complete the test.
 */
export const saveTestProgress = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const { id } = req.params;
  const { answers = [], currentIndex = 0 } = req.body as {
    answers: { questionId: string; selectedOption: string; timeSpentSec?: number }[];
    currentIndex: number;
  };

  const test = await Test.findOne({ _id: id, userId });
  if (!test) throw new AppError('test_not_found', 404);
  if (test.completed) {
    // Already submitted — nothing to save.
    return res.json({ success: true, data: { saved: false } });
  }

  test.answers = (answers || [])
    .filter((a) => a && a.questionId && a.selectedOption)
    .map((a) => ({
      questionId: a.questionId as any,
      selectedOption: a.selectedOption,
      timeSpentSec: Number(a.timeSpentSec) || 0,
    })) as any;
  (test as any).currentIndex = Math.max(0, Number(currentIndex) || 0);
  await test.save();

  res.json({ success: true, data: { saved: true } });
});

export const submitTest = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const { id } = req.params;
  const { answers = [], timeTakenSec = 0 } = req.body;

  const test = await Test.findOne({ _id: id, userId });
  if (!test) throw new AppError('test_not_found', 404);
  if (test.completed) throw new AppError('test_already_submitted', 400);

  // Fetch full questions with correct answers
  const questions = await Question.find({ _id: { $in: test.questions } }).lean();
  const questionMap: any = {};
  questions.forEach(q => { questionMap[q._id.toString()] = q; });

  // Deduplicate answers from payload if any
  const uniqueAnswers = answers.filter((v: any, i: any, a: any) => 
    a.findIndex((t: any) => t.questionId === v.questionId) === i
  );

  let score = 0;
  const totalQuestionsCount = test.totalQuestions || questions.length || 20;

  console.log(`[Test Submission] User: ${userId}, Test: ${test._id}, Answers Received: ${uniqueAnswers.length}`);

  const answerDocs = uniqueAnswers.map((a: any) => {
    const q = questionMap[String(a.questionId)];
    if (!q) return null;
    
    const userAns = String(a.selectedOption || '').trim().toLowerCase();
    const correctAns = String(q.correctOption || '').trim().toLowerCase();
    
    const isCorrect = userAns === correctAns;
    if (isCorrect) score++;

    return { 
      testId: test._id, 
      questionId: a.questionId, 
      selectedOption: a.selectedOption, 
      isCorrect: !!isCorrect, 
      timeSpentSec: Number(a.timeSpentSec) || 0
    };
  }).filter(Boolean);

  console.log(`[Test Submission] Final Score Calculated: ${score} / ${totalQuestionsCount}`);

  // Atomically claim-and-complete: the update only matches while completed is
  // still false, so two concurrent submits can't both score the test (and
  // double-count streak/topic stats). If it returns null, another request
  // already submitted this test.
  const claimed = await Test.findOneAndUpdate(
    { _id: test._id, userId, completed: false },
    {
      score,
      timeTakenSec: Number(timeTakenSec) || 0,
      completed: true,
      answers: answerDocs.map((a: any) => ({
        questionId: a.questionId,
        questionVersion: questionMap[a.questionId.toString()]?.version || 1,
        selectedOption: a.selectedOption,
        isCorrect: a.isCorrect,
        timeSpentSec: a.timeSpentSec
      })),
      updatedAt: new Date()
    },
    { new: true }
  );

  if (!claimed) throw new AppError('test_already_submitted', 400);

  // For a practice drill, capture the topic's accuracy BEFORE this attempt.
  const isPractice = test.type === 'practice';
  let beforeAcc = 0;
  if (isPractice && test.subject && test.topic) {
    const before = await UserTopicStat
      .findOne({ userId, subject: test.subject, topic: test.topic })
      .lean() as any;
    // Use recent (EMA) accuracy so the reported improvement matches what the
    // user sees on the weakness fixer; fall back to lifetime for legacy rows.
    beforeAcc = before
      ? Math.round(((before.recentAccuracyPct ?? before.accuracyPct ?? 0)) * 10) / 10
      : 0;
  }

  // Update topic stats (scoped to the test's exam)
  await updateTopicStats(userId, answerDocs, questionMap, (test as any).examType || 'SSC');

  // Streak counts only for the daily mock, not practice drills.
  if (!isPractice) {
    await updateStreak(userId);
  }

  const accuracyPct = ((score / totalQuestionsCount) * 100).toFixed(1);
  const responseData: any = {
    score,
    total: totalQuestionsCount,
    accuracyPct,
    timeTakenSec,
  };

  // Report how much this practice drill moved the topic's accuracy.
  if (isPractice && test.subject && test.topic) {
    const after = await UserTopicStat
      .findOne({ userId, subject: test.subject, topic: test.topic })
      .lean() as any;
    const afterAcc = after
      ? Math.round(((after.recentAccuracyPct ?? after.accuracyPct ?? 0)) * 10) / 10
      : 0;
    responseData.improvement = {
      subject: test.subject,
      topic: test.topic,
      thisTestAccuracy: Number(accuracyPct),
      beforeAccuracy: beforeAcc,
      afterAccuracy: afterAcc,
      delta: Math.round((afterAcc - beforeAcc) * 10) / 10,
      beforeLevel: masteryLevel(beforeAcc),
      afterLevel: masteryLevel(afterAcc),
      totalAttempted: after?.totalAttempted || 0,
    };
  }

  res.json({ success: true, data: responseData });
});

export const getTestReview = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  const { id } = req.params;

  const test = await Test.findOne({ _id: id, userId });
  if (!test) throw new AppError('test_not_found', 404);

  const answers: any[] = test.answers || [];
  const questions = await Question.find({ _id: { $in: test.questions } }).lean();

  // Which of these questions has the user already bookmarked?
  const bookmarks = await Bookmark.find({ userId, questionId: { $in: test.questions } })
    .select('questionId')
    .lean();
  const bookmarkedSet = new Set(bookmarks.map((b: any) => b.questionId.toString()));

  // Merge questions with user answers
  const answerMap: any = {};
  answers.forEach((a: any) => {
    if (a.questionId) {
      answerMap[a.questionId.toString()] = a;
    }
  });

  const result = questions.map(q => {
    const lang = req.lang || 'en';
    
    // Pick text for the requested language from the nested bilingual model.
    const getTxt = (field: any, l: string) =>
      field?.[l] || field?.en || field?.hi || '';

    return {
      questionId: q._id,
      questionText: getTxt(q.questionText, lang),
      optionA: getTxt((q.options as any)?.a, lang),
      optionB: getTxt((q.options as any)?.b, lang),
      optionC: getTxt((q.options as any)?.c, lang),
      optionD: getTxt((q.options as any)?.d, lang),
      correctOption: q.correctOption,
      // Response key kept as `explanationHindi` for the existing Angular review
      // screen; it now carries the selected-language explanation text.
      explanationHindi: getTxt((q as any).explanation, lang),
      subject: q.subject, 
      topic: q.topic,
      selectedOption: answerMap[q._id.toString()]?.selectedOption,
      isCorrect: answerMap[q._id.toString()]?.isCorrect,
      isBookmarked: bookmarkedSet.has(q._id.toString()),
    };
  });

  res.json({ success: true, data: result });
});

export const getTestHistory = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  
  const limit = parseInt(req.query.limit as string) || 30;
  const typeParam = String(req.query.type || 'daily').toLowerCase();

  // Scope history to the user's current exam.
  const histUser = await User.findById(userId).select('examType').lean();
  const histExamType = (histUser as any)?.examType || 'SSC';

  // 'daily' (default) = everything that counts toward ranking; 'practice' =
  // practice attempts only; 'all' = both.
  const filter: any = { userId, completed: true, examType: histExamType };
  if (typeParam === 'practice') filter.type = 'practice';
  else if (typeParam !== 'all') filter.type = { $ne: 'practice' };

  const tests = await Test.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('testDate score totalQuestions timeTakenSec type createdAt');

  res.json({ success: true, data: tests });
});
