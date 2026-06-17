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
import { MASTERY_THRESHOLD } from '@/services/analyticsService';
import { getTodayIST } from '@/utils/dateHelper';
import { env } from '@/lib/config';
import { cacheGet, cacheSet } from '@/utils/cache';

export const listUsers = asyncHandler(async (req: LangRequest, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const page = Math.max(parseInt(req.query.page as string) || 1, 1);
  const skip = (page - 1) * limit;

  const users = await getUsers({ limit, skip });
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
  if (!userId) throw new AppError('unauthorized', 401);
  const user = await User.findById(userId);
  if (!user) throw new AppError('user_not_found', 404);

  // Aggregate totals in the DB instead of loading every completed test (with
  // its full answers array) into memory and reducing in JS.
  const [agg] = await Test.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        completed: true,
        type: { $ne: 'practice' },
      },
    },
    {
      $group: {
        _id: null,
        totalTests: { $sum: 1 },
        totalScore: { $sum: '$score' },
        bestScore: { $max: '$score' },
      },
    },
  ]);

  const totalTests = agg?.totalTests || 0;
  const avgScore = totalTests > 0 ? (agg.totalScore || 0) / totalTests : 0;
  const bestScore = agg?.bestScore || 0;

  // Calculate trial days (assume 7 days)
  const trialDaysUsed = Math.floor((Date.now() - new Date(user.trialStartDate).getTime()) / (1000 * 60 * 60 * 24));
  const trialDaysRemaining = Math.max(0, 7 - trialDaysUsed);

  // Today's daily-test status for the home card (one test per day):
  // not_started → can start; in_progress → resume; completed → locked + result.
  const today = getTodayIST();
  const todayDaily: any = await Test.findOne({
    userId,
    type: { $ne: 'practice' },
    testDate: today,
  })
    .sort({ completed: -1, createdAt: -1 })
    .select('score totalQuestions completed')
    .lean();

  const todayTest = {
    status: !todayDaily
      ? 'not_started'
      : todayDaily.completed
        ? 'completed'
        : 'in_progress',
    testId: todayDaily?._id?.toString() ?? null,
    score: todayDaily?.completed ? (todayDaily.score ?? 0) : null,
    total: todayDaily?.totalQuestions ?? 20,
  };

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
      appLanguage: user.appLanguage || 'english',
      name: user.name || '',
      phone: user.phone,
      examType: user.examType || 'SSC',
      state: user.state || '',
      avatar: user.avatar || 'aspirant',
      trialDaysRemaining,
      todayTest,
    }
  });
});

export const updateProfile = asyncHandler(async (req: LangRequest, res: Response) => {
  const { name, exam_type, preferred_language, app_language, state, avatar } = req.body as UpdateProfileInput & { avatar?: string };

  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (state !== undefined) updateData.state = state;
  if (exam_type !== undefined) updateData.examType = exam_type;
  if (preferred_language !== undefined) updateData.preferredLanguage = preferred_language;
  if (app_language !== undefined) updateData.appLanguage = app_language;
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
      appLanguage: user.appLanguage || 'english',
      state: user.state || '',
      avatar: user.avatar || 'aspirant'
    }
  });
});

export const getWeakTopics = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  
  // A topic is "weak" only while its recent proficiency is below the mastery
  // cut-off. Once practice lifts recentAccuracyPct to/above MASTERY_THRESHOLD it
  // drops off this list — that's how a weakness gets "fixed". Legacy rows with
  // no recentAccuracyPct yet are still included so they show until re-practised.
  const rows = await UserTopicStat.find({
    userId: new mongoose.Types.ObjectId(userId),
    totalAttempted: { $gte: 5 }, // need enough attempts to judge
    $or: [
      { recentAccuracyPct: { $lt: MASTERY_THRESHOLD } },
      { recentAccuracyPct: { $exists: false } },
    ],
  })
    .sort({ recentAccuracyPct: 1 }) // ascending = weakest first
    .limit(5)
    .lean();

  // Surface the recent (improving) accuracy as `accuracyPct` so the app's
  // progress bar and priority tag reflect current proficiency, not the sticky
  // lifetime average. Fall back to lifetime for legacy rows.
  const data = rows.map((t: any) => {
    const recent = t.recentAccuracyPct ?? t.accuracyPct ?? 0;
    return {
      _id: t._id,
      subject: t.subject,
      topic: t.topic,
      totalAttempted: t.totalAttempted,
      totalCorrect: t.totalCorrect,
      accuracyPct: recent,
      recentAccuracyPct: recent,
      lifetimeAccuracyPct: t.accuracyPct ?? 0,
      lastAttemptedAt: t.lastAttemptedAt,
    };
  });

  res.status(200).json({
    success: true,
    data,
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

  const myObjectId = new mongoose.Types.ObjectId(userId);

  // The requesting user (as a document so we can persist the rank snapshot).
  const me = await User.findById(userId);
  const myState = ((me as any)?.state || '').trim();

  // Rank every user by total score, and attach their profile (name, examType,
  // state) in the same aggregation so we can derive BOTH the all-India and the
  // state leaderboard from one sorted list.
  //
  // This scans/aggregates the entire tests collection, so in production the
  // result is cached briefly and shared across all viewers (standings barely
  // change second-to-second). In development the TTL is 0, so it's always fresh.
  const LEADERBOARD_TTL_MS = env.isProduction ? 60_000 : 0;
  let ranking = cacheGet<any[]>('global_ranking');
  if (!ranking) {
    ranking = await Test.aggregate([
    { $match: { completed: true, type: { $ne: 'practice' } } },
    {
      $group: {
        _id: '$userId',
        totalScore: { $sum: '$score' },
        tests: { $sum: 1 },
      },
    },
    { $sort: { totalScore: -1, tests: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        totalScore: 1,
        tests: 1,
        name: '$user.name',
        examType: '$user.examType',
        state: '$user.state',
      },
    },
    ]);
    cacheSet('global_ranking', ranking, LEADERBOARD_TTL_MS);
  }

  // Build display rows (top 20) from any pre-sorted slice of the ranking.
  const buildRows = (rows: any[]) =>
    rows.slice(0, 20).map((row: any, i: number) => ({
      rank: i + 1,
      name: row.name && row.name.trim() ? row.name : 'Warrior',
      examType: row.examType || 'SSC',
      state: row.state || '',
      totalScore: row.totalScore,
      tests: row.tests,
      isMe: row._id.equals(myObjectId),
    }));

  // ---- All India ----
  const myIndex = ranking.findIndex((r: any) => r._id.equals(myObjectId));
  const myRank = myIndex >= 0 ? myIndex + 1 : null;
  const leaderboard = buildRows(ranking);

  // ---- State (same ordering, filtered to the user's state) ----
  let stateRank: number | null = null;
  let stateTotalPlayers = 0;
  let stateLeaderboard: any[] = [];
  if (myState) {
    const stateRanking = ranking.filter(
      (r: any) => (r.state || '').trim().toLowerCase() === myState.toLowerCase(),
    );
    stateTotalPlayers = stateRanking.length;
    const sIndex = stateRanking.findIndex((r: any) => r._id.equals(myObjectId));
    stateRank = sIndex >= 0 ? sIndex + 1 : null;
    stateLeaderboard = buildRows(stateRanking);
  }

  // ---- Day-over-day rank movement ----
  // We keep a per-day snapshot on the user. The baseline ("prev") is the rank
  // recorded on the most recent earlier day. Change is signed so that a POSITIVE
  // value means the user IMPROVED (moved up — i.e. their rank number went down).
  let allIndiaRankChange: number | null = null;
  let stateRankChange: number | null = null;
  if (me) {
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const track: any = (me as any).rankTrack || {};

    let allIndiaPrev: number | null;
    let statePrev: number | null;

    if (track.dateKey === todayKey) {
      // Same day: keep the existing baseline, just refresh today's live values.
      allIndiaPrev = track.allIndiaPrev ?? null;
      statePrev = track.statePrev ?? null;
      track.allIndiaToday = myRank;
      track.stateToday = stateRank;
    } else {
      // New day: yesterday's recorded rank becomes the new baseline.
      allIndiaPrev = track.allIndiaToday ?? null;
      statePrev = track.stateToday ?? null;
      track.allIndiaPrev = allIndiaPrev;
      track.statePrev = statePrev;
      track.allIndiaToday = myRank;
      track.stateToday = stateRank;
      track.dateKey = todayKey;
    }

    (me as any).rankTrack = track;
    me.markModified('rankTrack');
    await me.save();

    if (allIndiaPrev != null && myRank != null) {
      allIndiaRankChange = allIndiaPrev - myRank;
    }
    if (statePrev != null && stateRank != null) {
      stateRankChange = statePrev - stateRank;
    }
  }

  res.status(200).json({
    success: true,
    data: {
      myRank,
      totalPlayers: ranking.length,
      leaderboard,
      allIndiaRankChange,
      state: myState || null,
      stateRank,
      stateTotalPlayers,
      stateLeaderboard,
      stateRankChange,
    },
  });
});
