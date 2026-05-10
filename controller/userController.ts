import { type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { getUsers, updateUserExamType } from '@/services/userService';
import { AuthRequest } from '@/middleware/authMiddleware';
import { asyncHandler } from '@/utils/asyncHandler';

import { User } from '@/model/user.model';
import { Test } from '@/model/test.model';
import { UserTopicStat } from '@/model/userTopicStat.model';

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const users = await getUsers();
  res.status(200).json({
    success: true,
    message: 'Users fetched successfully',
    data: users,
  });
});

export const updateExamType = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { examType } = req.body;
  const validTypes = ['SSC', 'RAILWAY', 'BANKING', 'UPSC'];
  
  if (!validTypes.includes(examType)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid exam type' 
    });
  }

  const user = await updateUserExamType(req.userId!, examType);
  
  res.status(200).json({ 
    success: true, 
    message: 'Exam type updated successfully',
    data: user 
  });
});

export const getUserStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const tests = await Test.find({ userId, completed: true });
  
  const totalTests = tests.length;
  const totalScore = tests.reduce((acc, curr) => acc + (curr.score || 0), 0);
  const avgScore = totalTests > 0 ? totalScore / totalTests : 0;
  const bestScore = totalTests > 0 ? Math.max(...tests.map(t => t.score || 0)) : 0;

  // Calculate trial days (assume 7 days)
  const trialDaysUsed = Math.floor((Date.now() - new Date(user.trialStartDate).getTime()) / (1000 * 60 * 60 * 24));
  const trialDaysRemaining = Math.max(0, 7 - trialDaysUsed);

  res.status(200).json({
    success: true,
    data: {
      totalTests,
      avgScore: avgScore.toFixed(1),
      bestScore,
      streakCount: user.streakCount,
      overallAccuracy: totalTests ? ((avgScore / 20) * 100).toFixed(1) : "0",
      subscriptionStatus: user.subscriptionStatus,
      trialDaysRemaining
    }
  });
});

export const getWeakTopics = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  
  const topics = await UserTopicStat.find({
    userId: new mongoose.Types.ObjectId(userId),
    totalAttempted: { $gte: 5 }  // Minimum 5 attempts to be considered
  })
  .sort({ accuracyPct: 1 })  // ascending = weakest first
  .limit(5);

  res.status(200).json({
    success: true,
    data: topics
  });
});

export const getSubjectStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.userId;
  
  const stats = await UserTopicStat.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$subject',
        avgAccuracy: { $avg: '$accuracyPct' },
        totalAttempted: { $sum: '$totalAttempted' }
      }
    },
    { $sort: { avgAccuracy: -1 } }
  ]);

  const formattedStats = stats.map(s => ({
    subject: s._id,
    accuracy: Math.round(s.avgAccuracy),
    totalAttempted: s.totalAttempted
  }));

  res.status(200).json({
    success: true,
    data: formattedStats
  });
});
