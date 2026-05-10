import { Request, Response } from 'express';
import { AuthRequest } from '@/middleware/authMiddleware';
import { Test } from '@/model/test.model';
import { Question } from '@/model/question.model';
import { UserTopicStat } from '@/model/userTopicStat.model';
import { User } from '@/model/user.model';
import { TestAnswer } from '@/model/testAnswer.model';
import { getTodayIST, getTodayStart } from '@/utils/dateHelper';
import { updateTopicStats, updateStreak } from '@/services/analyticsService';

export const getTodayTest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: true, message: 'Unauthorized' });
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
      if (!user) return res.status(404).json({ message: 'User not found' });

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
          return res.status(404).json({ message: 'No questions found for this exam type' });
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

      test = await test.populate('questions', '-correctOption -explanationHindi');
    }

    res.json({ success: true, data: test });
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching today\'s test', error: error.message });
  }
};

export const submitTest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: true, message: 'Unauthorized' });

    const { id } = req.params;
    const { answers = [], timeTakenSec = 0 } = req.body;

    const test = await Test.findOne({ _id: id, userId });
    if (!test) return res.status(404).json({ error: true, message: 'Test nahi mila' });
    if (test.completed) return res.status(400).json({ error: true, message: 'Test pehle se submit ho gaya' });

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

    // Save answers
    if (answerDocs.length > 0) {
      await TestAnswer.insertMany(answerDocs);
    }

    // Update test
    await Test.findByIdAndUpdate(test._id, {
      score, 
      timeTakenSec: Number(timeTakenSec) || 0, 
      completed: true,
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
  } catch (error: any) {
    console.error(`[Test Submit Error]`, error);
    res.status(500).json({ message: 'Error submitting test', error: error.message });
  }
};

export const getTestReview = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: true, message: 'Unauthorized' });
    const { id } = req.params;

    const test = await Test.findOne({ _id: id, userId });
    if (!test) return res.status(404).json({ error: true, message: 'Test not found' });

    const answers = await TestAnswer.find({ testId: test._id });
    const questions = await Question.find({ _id: { $in: test.questions } });

    // Merge questions with user answers
    const answerMap: any = {};
    answers.forEach(a => { answerMap[a.questionId.toString()] = a; });

    const result = questions.map(q => ({
      questionId: q._id,
      questionText: q.questionText,
      optionA: q.optionA, 
      optionB: q.optionB, 
      optionC: q.optionC, 
      optionD: q.optionD,
      correctOption: q.correctOption,
      explanationHindi: q.explanationHindi,
      subject: q.subject, 
      topic: q.topic,
      selectedOption: answerMap[q._id.toString()]?.selectedOption,
      isCorrect: answerMap[q._id.toString()]?.isCorrect,
    }));

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching test review', error: error.message });
  }
};

export const getTestHistory = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ error: true, message: 'Unauthorized' });
    
    const limit = parseInt(req.query.limit as string) || 30;

    const tests = await Test.find({ userId, completed: true })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('testDate score timeTakenSec createdAt');

    res.json({ success: true, data: tests });
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching test history', error: error.message });
  }
};
