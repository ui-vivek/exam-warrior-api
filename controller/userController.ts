import { type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { getUsers, updateUserExamType, updateUserLanguage, updateUserProfile } from '@/services/userService';
import { AuthRequest } from '@/middleware/authMiddleware';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { getMessage } from '@/utils/messages';
import { LangRequest } from '@/middleware/languageMiddleware';
import { UpdateProfileInput, UpdateLanguageInput, UpdateExamTypeInput } from '@/validators/userValidator';

import { User } from '@/model/user.model';
import { Test } from '@/model/test.model';
import { UserTopicStat } from '@/model/userTopicStat.model';

export const listUsers = asyncHandler(async (req: LangRequest, res: Response) => {
  const users = await getUsers();
  res.status(200).json({
    success: true,
    message: 'Users fetched successfully',
    data: users,
  });
});

export const updateExamType = asyncHandler(async (req: LangRequest, res: Response) => {
  const { examType } = req.body as UpdateExamTypeInput;

  const user = await updateUserExamType(req.userId!, examType);
  
  res.status(200).json({ 
    success: true, 
    message: getMessage('exam_type_updated', req.lang),
    data: user 
  });
});

export const updateLanguage = asyncHandler(async (req: LangRequest, res: Response) => {
  const { preferredLanguage } = req.body as UpdateLanguageInput;

  const user = await updateUserLanguage(req.userId!, preferredLanguage);
  
  res.status(200).json({ 
    success: true, 
    message: getMessage('language_updated', req.lang),
    data: user 
  });
});

export const getUserStats = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  const user = await User.findById(userId);
  if (!user) throw new AppError('user_not_found', 404);

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
      preferredLanguage: user.preferredLanguage || 'english',
      name: user.name || '',
      phone: user.phone,
      examType: user.examType || 'SSC',
      state: user.state || '',
      avatar: user.avatar || 'aspirant',
      trialDaysRemaining
    }
  });
});

export const updateProfile = asyncHandler(async (req: LangRequest, res: Response) => {
  const { name, exam_type, preferred_language, state, avatar } = req.body as UpdateProfileInput & { avatar?: string };
  
  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (state !== undefined) updateData.state = state;
  if (exam_type !== undefined) updateData.examType = exam_type;
  if (preferred_language !== undefined) updateData.preferredLanguage = preferred_language;
  if (avatar !== undefined) updateData.avatar = avatar;

  const user = await updateUserProfile(req.userId!, updateData);

  res.status(200).json({
    success: true,
    message: getMessage('profile_updated', req.lang),
    data: {
      name: user.name || '',
      phone: user.phone,
      examType: user.examType || 'SSC',
      preferredLanguage: user.preferredLanguage || 'english',
      state: user.state || '',
      avatar: user.avatar || 'aspirant'
    }
  });
});

export const getWeakTopics = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  
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

export const getSubjectStats = asyncHandler(async (req: LangRequest, res: Response) => {
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

/**
 * GET /users/leaderboard
 * Global "All India Rank" — ranks users by total score across completed tests.
 */
export const getLeaderboard = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const ranking = await Test.aggregate([
    { $match: { completed: true } },
    {
      $group: {
        _id: '$userId',
        totalScore: { $sum: '$score' },
        tests: { $sum: 1 },
      },
    },
    { $sort: { totalScore: -1, tests: -1 } },
  ]);

  const myObjectId = new mongoose.Types.ObjectId(userId);
  const myIndex = ranking.findIndex((r: any) => r._id.equals(myObjectId));
  const myRank = myIndex >= 0 ? myIndex + 1 : null;

  const top = ranking.slice(0, 20);
  const topUsers = await User.find({ _id: { $in: top.map((t: any) => t._id) } })
    .select('name examType')
    .lean();
  const userMap: Record<string, any> = {};
  topUsers.forEach((u: any) => { userMap[u._id.toString()] = u; });

  const leaderboard = top.map((row: any, i: number) => {
    const u = userMap[row._id.toString()] || {};
    return {
      rank: i + 1,
      name: (u.name && u.name.trim()) ? u.name : 'Warrior',
      examType: u.examType || 'SSC',
      totalScore: row.totalScore,
      tests: row.tests,
      isMe: row._id.equals(myObjectId),
    };
  });

  res.status(200).json({
    success: true,
    data: {
      myRank,
      totalPlayers: ranking.length,
      leaderboard,
    },
  });
});
