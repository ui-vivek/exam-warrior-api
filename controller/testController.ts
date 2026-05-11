import { Request, Response } from 'express';
import { AuthRequest } from '@/middleware/authMiddleware';
import { Test } from '@/model/test.model';
import { Question } from '@/model/question.model';
import { UserTopicStat } from '@/model/userTopicStat.model';
import { User } from '@/model/user.model';
import { getTodayIST, getTodayStart } from '@/utils/dateHelper';
import { updateTopicStats, updateStreak } from '@/services/analyticsService';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { getMessage } from '@/utils/messages';
import { LangRequest } from '@/middleware/languageMiddleware';

export const getTodayTest = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  const today = getTodayIST();

  // Check if test already exists for today
  let test = await Test.findOne({ userId, testDate: today })
    .populate('questions', '-correctOption -explanationHindi');

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
    let questions: any[] = [];

    if (weakTopicNames.length > 0) {
      // 1. Prioritize questions from weak topics (max 10)
      questions = await Question.aggregate([
        { $match: { examType: user.examType, isActive: true, topic: { $in: weakTopicNames } } },
        { $sample: { size: 10 } }
      ]);
    }

    // 2. Fill remaining (or all if no weak topics) from today's pool
    const remainingSize = 20 - questions.length;
    if (remainingSize > 0) {
      const todayPool = await Question.aggregate([
        { 
          $match: { 
            examType: user.examType, 
            isActive: true, 
            _id: { $nin: questions.map(q => q._id) },
            generationDate: { $gte: getTodayStart() } 
          } 
        },
        { $sample: { size: remainingSize } }
      ]);
      questions.push(...todayPool);
    }

    // 3. Last fallback: if still not 20, pick from any active questions
    if (questions.length < 20) {
      const finalFallback = await Question.aggregate([
        { 
          $match: { 
            examType: user.examType, 
            isActive: true, 
            _id: { $nin: questions.map(q => q._id) } 
          } 
        },
        { $sample: { size: 20 - questions.length } }
      ]);
      questions.push(...finalFallback);
    }

    // If not enough questions from today, fallback to any active questions of that examType
    if (questions.length < 20) {
      const fallbackQuestions = await Question.aggregate([
        { $match: { examType: user.examType, isActive: true } },
        { $sample: { size: 20 } }
      ]);
      
      if (fallbackQuestions.length === 0) {
        throw new AppError('no_questions_found', 404);
      }
      
      test = await Test.create({
        userId,
        testDate: today,
        questions: fallbackQuestions.map(q => q._id),
      });
    } else {
      test = await Test.create({
        userId,
        testDate: today,
        questions: questions.map(q => q._id),
      });
    }

    test = await test.populate('questions', '-correctOption -explanation');
  }

  const lang = req.lang || 'en';
  const testObj = test.toObject();
  
  if (testObj.questions) {
    testObj.questions = testObj.questions.map((q: any) => {
      const getT = (field: any) => {
        if (typeof field === 'string') return field;
        return field?.[lang] || field?.en || '';
      };

      return {
        ...q,
        questionText: getT(q.questionText),
        optionA: q.options?.a ? getT(q.options.a) : q.optionA,
        optionB: q.options?.b ? getT(q.options.b) : q.optionB,
        optionC: q.options?.c ? getT(q.options.c) : q.optionC,
        optionD: q.options?.d ? getT(q.options.d) : q.optionD,
        explanation: q.explanation ? getT(q.explanation) : q.explanationHindi
      };
    });
  }

  res.json({ success: true, data: testObj });
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
  const questions = await Question.find({ _id: { $in: test.questions } });
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

  // Update test with answers and results
  await Test.findByIdAndUpdate(test._id, {
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
  });

  // Update topic stats
  await updateTopicStats(userId, answerDocs, questionMap);

  // Update streak
  await updateStreak(userId);

  res.json({ 
    success: true, 
    data: { 
      score, 
      total: totalQuestionsCount, 
      accuracyPct: ((score / totalQuestionsCount) * 100).toFixed(1), 
      timeTakenSec 
    } 
  });
});

export const getTestReview = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  const { id } = req.params;

  const test = await Test.findOne({ _id: id, userId });
  if (!test) throw new AppError('test_not_found', 404);

  const answers: any[] = test.answers || [];
  const questions = await Question.find({ _id: { $in: test.questions } });

  // Merge questions with user answers
  const answerMap: any = {};
  answers.forEach((a: any) => { 
    if (a.questionId) {
      answerMap[a.questionId.toString()] = a; 
    }
  });

  const result = questions.map(q => {
    const lang = req.lang || 'en';
    
    // Helper to get text from multilingual field or fallback to legacy string
    const getTxt = (field: any, l: string) => {
      if (typeof field === 'string') return field;
      return field?.[l] || field?.en || '';
    };

    return {
      questionId: q._id,
      questionText: getTxt(q.questionText, lang),
      optionA: (q.options as any)?.a ? getTxt((q.options as any).a, lang) : (q as any).optionA, 
      optionB: (q.options as any)?.b ? getTxt((q.options as any).b, lang) : (q as any).optionB, 
      optionC: (q.options as any)?.c ? getTxt((q.options as any).c, lang) : (q as any).optionC, 
      optionD: (q.options as any)?.d ? getTxt((q.options as any).d, lang) : (q as any).optionD,
      correctOption: q.correctOption,
      explanationHindi: (q as any).explanationHindi || getTxt((q as any).explanation, lang),
      subject: q.subject, 
      topic: q.topic,
      selectedOption: answerMap[q._id.toString()]?.selectedOption,
      isCorrect: answerMap[q._id.toString()]?.isCorrect,
    };
  });

  res.json({ success: true, data: result });
});

export const getTestHistory = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  
  const limit = parseInt(req.query.limit as string) || 30;

  const tests = await Test.find({ userId, completed: true })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('testDate score timeTakenSec createdAt');

  res.json({ success: true, data: tests });
});
