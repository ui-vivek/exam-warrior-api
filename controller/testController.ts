import { Request, Response } from 'express';
import { Test } from '@/model/test.model';
import { Question } from '@/model/question.model';
import { User } from '@/model/user.model';
import { TestAnswer } from '@/model/testAnswer.model';
import { getTodayIST, getTodayStart } from '@/utils/dateHelper';
import { updateTopicStats, updateStreak } from '@/services/analyticsService';

export const getTodayTest = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
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

      // Pick 20 questions from today's pool for this user's exam type
      const questions = await Question.aggregate([
        { 
          $match: { 
            examType: user.examType, 
            isActive: true, 
            generationDate: { $gte: getTodayStart() } 
          } 
        },
        { $sample: { size: 20 } }
      ]);

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

export const submitTest = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { id } = req.params;
    const { answers, timeTakenSec } = req.body;

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
    const answerDocs = uniqueAnswers.map((a: any) => {
      const q = questionMap[a.questionId];
      const isCorrect = q && a.selectedOption === q.correctOption;
      if (isCorrect) score++;
      return { 
        testId: test._id, 
        questionId: a.questionId, 
        selectedOption: a.selectedOption, 
        isCorrect, 
        timeSpentSec: a.timeSpentSec 
      };
    });

    // Save answers
    await TestAnswer.insertMany(answerDocs);

    // Update test
    await Test.findByIdAndUpdate(test._id, {
      score, 
      timeTakenSec, 
      completed: true
    });

    // Update topic stats
    await updateTopicStats(userId, answerDocs, questionMap);

    // Update streak
    await updateStreak(userId);

    res.json({ 
      success: true, 
      data: { 
        score, 
        total: test.totalQuestions, 
        accuracyPct: ((score / test.totalQuestions) * 100).toFixed(1), 
        timeTakenSec 
      } 
    });
  } catch (error: any) {
    res.status(500).json({ message: 'Error submitting test', error: error.message });
  }
};

export const getTestReview = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
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

export const getTestHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const tests = await Test.find({ userId, completed: true })
      .sort({ createdAt: -1 })
      .select('testDate score totalQuestions timeTakenSec createdAt');

    res.json({ success: true, data: tests });
  } catch (error: any) {
    res.status(500).json({ message: 'Error fetching test history', error: error.message });
  }
};
