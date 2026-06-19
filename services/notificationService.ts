import mongoose from 'mongoose';
import { User } from '@/model/user.model';
import { Test } from '@/model/test.model';
import { UserTopicStat } from '@/model/userTopicStat.model';
import { UserDevice } from '@/model/userDevice.model';
import { sendPushToUsers } from '@/services/pushService';
import { getTodayIST } from '@/utils/dateHelper';

/**
 * Business-logic notification jobs. Each function decides WHO should receive a
 * push and WHAT it says, then delegates actual FCM delivery to pushService.
 * Every payload carries a `type` so the app can deep-link on tap:
 *   daily_reminder | streak_saver | weak_topic | subscription | rank_change
 */

const DAY = 24 * 60 * 60 * 1000;
// Don't pester users who haven't opened the app in a while — they get
// re-engagement messaging later, not daily nudges.
const ACTIVE_WINDOW_DAYS = 14;
const TRIAL_DAYS = 7;

/** UserIds that currently have at least one registered push token. */
const deviceUserIds = async (): Promise<mongoose.Types.ObjectId[]> => {
  const ids = await UserDevice.find({
    deviceToken: { $exists: true, $nin: [null, ''] },
  }).distinct('userId');
  return ids as mongoose.Types.ObjectId[];
};

const isRecentlyActive = (lastActiveDate?: Date | null): boolean => {
  if (!lastActiveDate) return true; // brand-new users count as active
  return Date.now() - new Date(lastActiveDate).getTime() <= ACTIVE_WINDOW_DAYS * DAY;
};

/**
 * Evening nudge to users who have NOT completed today's daily test yet (and are
 * recently active). The single highest-impact retention push.
 */
export const sendStreakSaverReminders = async () => {
  const ids = await deviceUserIds();
  if (ids.length === 0) return { users: 0, sent: 0, failed: 0, tokens: 0 };

  const users: any[] = await User.find({ _id: { $in: ids } })
    .select('lastActiveDate streakCount')
    .lean();

  const today = getTodayIST();
  const doneIds: any[] = await Test.find({
    userId: { $in: ids },
    type: { $ne: 'practice' },
    completed: true,
    testDate: today,
  }).distinct('userId');
  const done = new Set(doneIds.map((id) => id.toString()));

  const recipients = users
    .filter((u) => !done.has(u._id.toString()) && isRecentlyActive(u.lastActiveDate))
    .map((u) => u._id.toString());

  if (recipients.length === 0) return { users: 0, sent: 0, failed: 0, tokens: 0 };

  const result = await sendPushToUsers(recipients, {
    title: 'Don’t break your streak 🔥',
    body: 'You haven’t taken today’s test yet. Finish it and keep your streak alive!',
    data: { type: 'streak_saver' },
  });
  return { users: recipients.length, ...result };
};

/**
 * Personalised "drill your weakest topic" nudge. One push per user (different
 * topic each), deep-linking into Practice pre-filled with that subject.
 */
export const sendWeakTopicNudges = async () => {
  const ids = await deviceUserIds();
  if (ids.length === 0) return { users: 0, sent: 0, failed: 0, tokens: 0 };

  // Weakest topic per user, scoped to the user's CURRENT exam, with enough
  // attempts to be a real signal.
  const rows: any[] = await UserTopicStat.aggregate([
    { $match: { userId: { $in: ids }, totalAttempted: { $gte: 5 } } },
    {
      $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' },
    },
    { $unwind: '$u' },
    { $match: { $expr: { $eq: ['$examType', '$u.examType'] } } },
    { $sort: { recentAccuracyPct: 1, totalAttempted: -1 } },
    {
      $group: {
        _id: '$userId',
        subject: { $first: '$subject' },
        topic: { $first: '$topic' },
        acc: { $first: '$recentAccuracyPct' },
        lastActiveDate: { $first: '$u.lastActiveDate' },
      },
    },
  ]);

  let users = 0;
  let sent = 0;
  let failed = 0;
  let tokens = 0;

  for (const r of rows) {
    if (!isRecentlyActive(r.lastActiveDate)) continue;
    const acc = Math.round(r.acc || 0);
    const res = await sendPushToUsers([r._id.toString()], {
      title: 'Sharpen your weak spot 🎯',
      body: `${r.topic} (${r.subject}) is your weakest area — ${acc}% accuracy. Drill 10 questions now?`,
      data: { type: 'weak_topic', subject: String(r.subject || ''), topic: String(r.topic || '') },
    });
    users += 1;
    sent += res.sent;
    failed += res.failed;
    tokens += res.tokens;
  }

  return { users, sent, failed, tokens };
};

/**
 * Trial lifecycle: "2 days left" and "trial ended" nudges to the Subscription
 * screen. Windowed so a daily run notifies each user at most once per stage.
 */
export const sendTrialEndingReminders = async () => {
  const ids = await deviceUserIds();
  if (ids.length === 0) return { endingSoon: 0, expired: 0, sent: 0, failed: 0, tokens: 0 };

  const trialUsers: any[] = await User.find({
    _id: { $in: ids },
    subscriptionStatus: 'trial',
  })
    .select('trialStartDate')
    .lean();

  const now = Date.now();
  const endingSoon: string[] = [];
  const expired: string[] = [];

  for (const u of trialUsers) {
    if (!u.trialStartDate) continue;
    const msLeft = new Date(u.trialStartDate).getTime() + TRIAL_DAYS * DAY - now;
    if (msLeft <= 2 * DAY && msLeft > 1 * DAY) endingSoon.push(u._id.toString());
    else if (msLeft <= 0 && msLeft > -1 * DAY) expired.push(u._id.toString());
  }

  let sent = 0;
  let failed = 0;
  let tokens = 0;

  if (endingSoon.length) {
    const res = await sendPushToUsers(endingSoon, {
      title: '2 days left in your free trial ⏳',
      body: 'Subscribe now to keep daily tests, explanations and your streak going.',
      data: { type: 'subscription' },
    });
    sent += res.sent; failed += res.failed; tokens += res.tokens;
  }
  if (expired.length) {
    const res = await sendPushToUsers(expired, {
      title: 'Your free trial has ended',
      body: 'Subscribe for just ₹99/month to continue your prep without a break.',
      data: { type: 'subscription' },
    });
    sent += res.sent; failed += res.failed; tokens += res.tokens;
  }

  return { endingSoon: endingSoon.length, expired: expired.length, sent, failed, tokens };
};

/**
 * Weekly rank-movement push. Recomputes each exam's all-India ranking (same
 * basis as the leaderboard), compares to the last rank we pushed, and notifies
 * users who climbed (celebrate) or slipped a lot (gentle win-back).
 */
export const sendRankMovementNotifications = async () => {
  const ids = await deviceUserIds();
  if (ids.length === 0) return { users: 0, sent: 0, failed: 0, tokens: 0 };

  const users: any[] = await User.find({ _id: { $in: ids } })
    .select('examType lastNotifiedRank')
    .lean();

  // Group device users by their current exam so we only rank exams in play.
  const byExam = new Map<string, any[]>();
  for (const u of users) {
    const ex = u.examType || 'SSC';
    if (!byExam.has(ex)) byExam.set(ex, []);
    byExam.get(ex)!.push(u);
  }

  let sentUsers = 0;
  let sent = 0;
  let failed = 0;
  let tokens = 0;
  const bulk: any[] = [];

  for (const [examType, exUsers] of byExam) {
    // Full ranking for this exam (1-based by total daily-test score).
    const ranking: any[] = await Test.aggregate([
      { $match: { completed: true, type: { $ne: 'practice' }, examType } },
      { $group: { _id: '$userId', totalScore: { $sum: '$score' } } },
      { $sort: { totalScore: -1 } },
    ]);
    const rankOf = new Map<string, number>();
    ranking.forEach((r, i) => rankOf.set(r._id.toString(), i + 1));

    for (const u of exUsers) {
      const current = rankOf.get(u._id.toString());
      if (!current) continue; // user hasn't taken a ranked test yet
      const prev = u.lastNotifiedRank ?? null;

      // Always record the latest rank for next week's comparison.
      bulk.push({
        updateOne: {
          filter: { _id: u._id },
          update: { $set: { lastNotifiedRank: current } },
        },
      });

      if (prev == null) continue; // no baseline yet — record only

      let payload: { title: string; body: string } | null = null;
      if (current < prev) {
        const up = prev - current;
        payload = {
          title: `You climbed to All-India #${current} 🚀`,
          body: `Up ${up} place${up === 1 ? '' : 's'} this week. Keep the momentum — take today’s test!`,
        };
      } else if (current - prev >= 50) {
        payload = {
          title: `You slipped to #${current}`,
          body: 'A quick test today can climb you back up the rankings.',
        };
      }
      if (!payload) continue;

      const res = await sendPushToUsers([u._id.toString()], {
        ...payload,
        data: { type: 'rank_change' },
      });
      sentUsers += 1;
      sent += res.sent;
      failed += res.failed;
      tokens += res.tokens;
    }
  }

  if (bulk.length) await User.bulkWrite(bulk);
  return { users: sentUsers, sent, failed, tokens };
};

/**
 * "Your classroom results are ready" — fired when a room finishes (the last
 * participant submits). Event-driven, no cron. Deep-links to the room's
 * leaderboard. Caller should exclude whoever just submitted (already viewing it).
 */
export const notifyClassroomResult = async (code: string, userIds: string[]) => {
  if (!userIds.length) return { sent: 0, failed: 0, tokens: 0 };
  return sendPushToUsers(userIds, {
    title: 'Classroom results are ready 🏆',
    body: `Room ${code} has finished — see where you ranked!`,
    data: { type: 'classroom_result', code },
  });
};

/**
 * Transactional payment notification, fired from the Razorpay webhook.
 */
export const notifyPaymentEvent = async (
  userId: string,
  kind: 'success' | 'ended',
) => {
  const payload =
    kind === 'success'
      ? {
          title: 'Payment successful ✅',
          body: 'You’re Premium! Enjoy unlimited tests and Hindi explanations.',
          data: { type: 'subscription' },
        }
      : {
          title: 'Your subscription ended',
          body: 'Renew to keep unlimited access and continue your prep.',
          data: { type: 'subscription' },
        };
  return sendPushToUsers([userId], payload);
};
