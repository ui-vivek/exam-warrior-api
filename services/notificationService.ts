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
 *   daily_reminder | streak_saver | weak_topic | subscription | rank_change | referral
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
    title: 'Keep your streak alive 🔥',
    body: 'You haven’t taken today’s test yet. A few minutes now keeps your streak going.',
    data: { type: 'streak_saver' },
    channelId: 'reminders',
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
      title: 'Practice your weak area 🎯',
      body: `Your accuracy in ${r.topic} is ${acc}%. Try a quick 10-question drill to improve it.`,
      data: { type: 'weak_topic', subject: String(r.subject || ''), topic: String(r.topic || '') },
      channelId: 'updates',
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
    .select('trialStartDate appLanguage')
    .lean();

  const now = Date.now();
  const endingSoon: string[] = [];
  const expiredHi: string[] = [];
  const expiredEn: string[] = [];

  for (const u of trialUsers) {
    if (!u.trialStartDate) continue;
    const msLeft = new Date(u.trialStartDate).getTime() + TRIAL_DAYS * DAY - now;
    if (msLeft <= 2 * DAY && msLeft > 1 * DAY) {
      endingSoon.push(u._id.toString());
    } else if (msLeft <= 0 && msLeft > -1 * DAY) {
      ((u.appLanguage === 'hindi') ? expiredHi : expiredEn).push(u._id.toString());
    }
  }

  let sent = 0;
  let failed = 0;
  let tokens = 0;

  if (endingSoon.length) {
    const res = await sendPushToUsers(endingSoon, {
      title: '2 days left in your trial ⏳',
      body: 'Subscribe to keep daily tests, detailed solutions, and progress tracking.',
      data: { type: 'subscription' },
      channelId: 'updates',
    });
    sent += res.sent; failed += res.failed; tokens += res.tokens;
  }

  // Trial just ended → lead with the FREE path (refer a friend for 15 days) and
  // mention Premium as the alternative. Language-aware; deep-links to referral.
  if (expiredHi.length) {
    const res = await sendPushToUsers(expiredHi, {
      title: 'ट्रायल खत्म — 15 दिन फ्री पाएं 🎁',
      body: 'एक दोस्त को रेफ़र करें: जब वो पहला टेस्ट दे, दोनों को 15 दिन फ्री प्रीमियम मिलेगा। या ₹99/माह से सब्सक्राइब करें।',
      data: { type: 'referral' },
      channelId: 'updates',
    });
    sent += res.sent; failed += res.failed; tokens += res.tokens;
  }
  if (expiredEn.length) {
    const res = await sendPushToUsers(expiredEn, {
      title: 'Trial ended — unlock 15 free days 🎁',
      body: 'Refer a friend: when they take their first test, you BOTH get 15 days free premium. Or subscribe from ₹99/month.',
      data: { type: 'referral' },
      channelId: 'updates',
    });
    sent += res.sent; failed += res.failed; tokens += res.tokens;
  }

  return {
    endingSoon: endingSoon.length,
    expired: expiredHi.length + expiredEn.length,
    sent,
    failed,
    tokens,
  };
};

/**
 * Growth nudge: tell free (trial / expired) users they can unlock premium for
 * free just by referring friends. Language-aware — each user gets the copy in
 * THEIR app language (Hindi or English). Cadence is controlled by the cron
 * schedule (weekly), so no per-user windowing is needed here.
 */
export const sendReferralNudges = async () => {
  const ids = await deviceUserIds();
  if (ids.length === 0) return { hindi: 0, english: 0, sent: 0, failed: 0, tokens: 0 };

  // Only free users — paid users don't need the "earn premium" hook.
  const users: any[] = await User.find({
    _id: { $in: ids },
    subscriptionStatus: { $in: ['trial', 'expired'] },
  })
    .select('appLanguage lastActiveDate')
    .lean();

  const recipients = users.filter((u) => isRecentlyActive(u.lastActiveDate));
  const hindiIds = recipients.filter((u) => (u.appLanguage || 'english') === 'hindi').map((u) => u._id.toString());
  const englishIds = recipients.filter((u) => (u.appLanguage || 'english') !== 'hindi').map((u) => u._id.toString());

  let sent = 0, failed = 0, tokens = 0;

  if (hindiIds.length) {
    const res = await sendPushToUsers(hindiIds, {
      title: 'Premium chahiye? Bilkul free! 🎁',
      body: 'Bas ek dost ko refer karo — jab woh pehla test de, dono ko free premium din milenge.',
      data: { type: 'referral' },
      channelId: 'updates',
    });
    sent += res.sent; failed += res.failed; tokens += res.tokens;
  }
  if (englishIds.length) {
    const res = await sendPushToUsers(englishIds, {
      title: 'Want premium for free? 🎁',
      body: 'Refer one friend — when they take their first test, you BOTH get free premium days.',
      data: { type: 'referral' },
      channelId: 'updates',
    });
    sent += res.sent; failed += res.failed; tokens += res.tokens;
  }

  return { hindi: hindiIds.length, english: englishIds.length, sent, failed, tokens };
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
          title: `All-India rank #${current} 🚀`,
          body: `You climbed ${up} place${up === 1 ? '' : 's'} this week. Take today’s test to keep rising.`,
        };
      } else if (current - prev >= 50) {
        payload = {
          title: `You dropped to rank #${current}`,
          body: 'Take today’s test to climb back up the rankings.',
        };
      }
      if (!payload) continue;

      const res = await sendPushToUsers([u._id.toString()], {
        ...payload,
        data: { type: 'rank_change' },
        channelId: 'updates',
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
    body: `Room ${code} has finished. Tap to see where you ranked.`,
    data: { type: 'classroom_result', code },
    channelId: 'updates',
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
          body: 'Welcome to Premium. You now have unlimited tests and detailed solutions.',
          data: { type: 'subscription' },
          channelId: 'updates',
        }
      : {
          title: 'Your subscription has ended',
          body: 'Renew to restore unlimited tests and detailed solutions.',
          data: { type: 'subscription' },
          channelId: 'updates',
        };
  return sendPushToUsers([userId], payload);
};
