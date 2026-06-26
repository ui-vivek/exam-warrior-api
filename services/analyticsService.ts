import mongoose from 'mongoose';
import { UserTopicStat } from '@/model/userTopicStat.model';
import { User } from '@/model/user.model';
import { getTodayIST, getYesterdayIST } from '@/utils/dateHelper';
import { awardBadges, streakBadges } from '@/services/badgeService';

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
export const updateTopicStats = async (userId: string, answerDocs: any[], questionMap: any, examType: string = 'SSC') => {
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

  // Each topic is updated with a SINGLE atomic aggregation-pipeline update — no
  // read-modify-write. The EMA is computed inside the database from the row's
  // own current values, so two concurrent tests touching the same topic can't
  // read the same `prevRecent` and clobber each other (the previous version
  // fetched the rows first, which lost updates under concurrency). Semantics are
  // identical to the old JS math: lifetime = newCorrect/newAttempted; recent =
  // seed from this drill for a brand-new/legacy-no-EMA row, otherwise EMA.
  const ops: any[] = groups.map((g) => {
    // This drill's own accuracy — a constant for this op.
    const batchAcc = g.attempted > 0 ? (g.correct / g.attempted) * 100 : 0;

    return {
      updateOne: {
        filter: { userId: userObjectId, examType, subject: g.subject, topic: g.topic },
        update: [
          // Stage 1: snapshot the pre-update values we need for the EMA seed
          // decision before we mutate the running totals.
          {
            $set: {
              _prevAttempted: { $ifNull: ['$totalAttempted', 0] },
              _prevRecent: { $ifNull: ['$recentAccuracyPct', { $ifNull: ['$accuracyPct', null] }] },
            },
          },
          // Stage 2: roll the running totals forward.
          {
            $set: {
              totalAttempted: { $add: ['$_prevAttempted', g.attempted] },
              totalCorrect: { $add: [{ $ifNull: ['$totalCorrect', 0] }, g.correct] },
              lastAttemptedAt: '$$NOW',
            },
          },
          // Stage 3: derive the two accuracies from the new totals + snapshot.
          {
            $set: {
              accuracyPct: {
                $round: [
                  {
                    $cond: [
                      { $gt: ['$totalAttempted', 0] },
                      { $multiply: [{ $divide: ['$totalCorrect', '$totalAttempted'] }, 100] },
                      0,
                    ],
                  },
                  1,
                ],
              },
              recentAccuracyPct: {
                $round: [
                  {
                    $cond: [
                      // Brand-new topic, or a legacy row with no EMA history.
                      { $or: [{ $eq: ['$_prevAttempted', 0] }, { $eq: ['$_prevRecent', null] }] },
                      batchAcc,
                      {
                        $add: [
                          { $multiply: [RECENT_WEIGHT, batchAcc] },
                          { $multiply: [1 - RECENT_WEIGHT, '$_prevRecent'] },
                        ],
                      },
                    ],
                  },
                  1,
                ],
              },
            },
          },
          // Stage 4: drop the scratch fields so they don't persist.
          { $unset: ['_prevAttempted', '_prevRecent'] },
        ],
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

  // Streak milestone badges (7/30/100 days).
  const badges = streakBadges(newStreak);
  if (badges.length) awardBadges(userId, badges).catch(() => {});
};
