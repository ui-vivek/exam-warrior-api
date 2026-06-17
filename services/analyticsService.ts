import mongoose from 'mongoose';
import { UserTopicStat } from '@/model/userTopicStat.model';
import { User } from '@/model/user.model';
import { getTodayIST, getYesterdayIST } from '@/utils/dateHelper';

/**
 * At/above this recent accuracy a topic is treated as "mastered" and drops off
 * the weakness list. Shared by the weak-topics query and the mastery labels.
 */
export const MASTERY_THRESHOLD = 70;

/**
 * EMA weight for the latest drill when computing recent accuracy. Higher =
 * recent practice counts more (faster to climb, faster to fall). 0.4 lets a
 * couple of good drills meaningfully move a long-stuck topic without erasing
 * history in a single test.
 */
export const RECENT_WEIGHT = 0.4;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Updates topic-wise proficiency for a user after a test.
 *
 * Tracks two accuracies per topic:
 *  - accuracyPct: lifetime (totalCorrect / totalAttempted) — stable, honest
 *    long-run number used for overall stats.
 *  - recentAccuracyPct: an exponential moving average that weights the latest
 *    drill (RECENT_WEIGHT) over the running value. This is what the weakness
 *    fixer ranks and clears by, so practising a topic visibly lifts it and a
 *    topic genuinely improved stops being flagged.
 */
export const updateTopicStats = async (userId: string, answerDocs: any[], questionMap: any) => {
  if (!answerDocs || answerDocs.length === 0) return;

  // Group this test's answers by topic.
  const topicGroups: Record<string, { subject: string; topic: string; attempted: number; correct: number }> = {};

  for (const answer of answerDocs) {
    const q = questionMap[answer.questionId];
    if (!q) continue;

    const key = `${q.subject}|${q.topic}`;
    if (!topicGroups[key]) {
      topicGroups[key] = { subject: q.subject, topic: q.topic, attempted: 0, correct: 0 };
    }

    topicGroups[key].attempted += 1;
    if (answer.isCorrect) {
      topicGroups[key].correct += 1;
    }
  }

  const groups = Object.values(topicGroups);
  if (groups.length === 0) return;

  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Fetch existing rows so we can compute the EMA from the previous value.
  const existing = await UserTopicStat.find({
    userId: userObjectId,
    $or: groups.map((g) => ({ subject: g.subject, topic: g.topic })),
  }).lean();

  const prevByKey: Record<string, any> = {};
  for (const row of existing) prevByKey[`${row.subject}|${row.topic}`] = row;

  const ops = groups.map((g) => {
    const prev = prevByKey[`${g.subject}|${g.topic}`];
    const prevAttempted = prev?.totalAttempted ?? 0;
    const prevCorrect = prev?.totalCorrect ?? 0;

    // Lifetime accuracy after this test.
    const newAttempted = prevAttempted + g.attempted;
    const newCorrect = prevCorrect + g.correct;
    const lifetimeAcc = newAttempted > 0 ? round1((newCorrect / newAttempted) * 100) : 0;

    // Recent accuracy: EMA of this drill's accuracy over the previous value.
    // For a brand-new topic, seed straight from this drill. For a legacy row
    // that has history but no EMA yet, seed the EMA from its lifetime accuracy
    // so it doesn't jump to "mastered" on a single lucky drill.
    const batchAcc = g.attempted > 0 ? (g.correct / g.attempted) * 100 : 0;
    const prevRecent = prev?.recentAccuracyPct ?? prev?.accuracyPct ?? null;
    const recentAcc = (prevAttempted === 0 || prevRecent == null)
      ? round1(batchAcc)
      : round1(RECENT_WEIGHT * batchAcc + (1 - RECENT_WEIGHT) * prevRecent);

    return {
      updateOne: {
        filter: { userId: userObjectId, subject: g.subject, topic: g.topic },
        update: {
          $inc: { totalAttempted: g.attempted, totalCorrect: g.correct },
          $set: {
            accuracyPct: lifetimeAcc,
            recentAccuracyPct: recentAcc,
            lastAttemptedAt: new Date(),
          },
        },
        upsert: true,
      },
    };
  });

  await UserTopicStat.bulkWrite(ops);
};

/**
 * Updates user's daily streak using IST timezone.
 * 
 * Rules:
 * - First ever test → streak = 1
 * - Same day (IST) → no change (no double increment)
 * - Consecutive day (yesterday IST) → streak + 1
 * - Gap of 2+ days → reset to 1
 */
export const updateStreak = async (userId: string) => {
  const user = await User.findById(userId);
  if (!user) return;

  const todayIST = getTodayIST();       // 'YYYY-MM-DD' in IST
  const yesterdayIST = getYesterdayIST(); // 'YYYY-MM-DD' in IST

  let newStreak: number;

  if (!user.lastActiveDate) {
    // First ever test
    newStreak = 1;
  } else {
    // Convert stored lastActiveDate to IST date string for comparison
    const istOffset = 5.5 * 60 * 60 * 1000;
    const lastActiveIST = new Date(new Date(user.lastActiveDate).getTime() + istOffset)
      .toISOString().split('T')[0];

    if (lastActiveIST === todayIST) {
      // Already counted today — no change
      console.log(`[Streak] Already counted today for user ${userId}. Streak: ${user.streakCount}`);
      return;
    } else if (lastActiveIST === yesterdayIST) {
      // Consecutive day — increment
      newStreak = user.streakCount + 1;
    } else {
      // Gap — reset streak
      newStreak = 1;
    }
  }

  await User.findByIdAndUpdate(userId, {
    streakCount: newStreak,
    lastActiveDate: new Date()
  });

  console.log(`[Streak] User: ${userId}, New Streak: ${newStreak}, Today IST: ${todayIST}`);
};
