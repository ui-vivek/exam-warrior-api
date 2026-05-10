import mongoose from 'mongoose';
import { UserTopicStat } from '@/model/userTopicStat.model';
import { User } from '@/model/user.model';
import { getTodayIST, getYesterdayIST } from '@/utils/dateHelper';

/**
 * Updates topic-wise proficiency for a user after a test
 * Uses bulkWrite for high performance
 */
export const updateTopicStats = async (userId: string, answerDocs: any[], questionMap: any) => {
  if (!answerDocs || answerDocs.length === 0) return;

  // Group by topic to avoid multiple increments for same topic in one bulkWrite (though MongoDB handles it, grouping is cleaner)
  const topicGroups: any = {};

  for (const answer of answerDocs) {
    const q = questionMap[answer.questionId];
    if (!q) continue;

    const key = `${q.subject}|${q.topic}`;
    if (!topicGroups[key]) {
      topicGroups[key] = {
        subject: q.subject,
        topic: q.topic,
        attempted: 0,
        correct: 0
      };
    }

    topicGroups[key].attempted += 1;
    if (answer.isCorrect) {
      topicGroups[key].correct += 1;
    }
  }

  const ops = Object.values(topicGroups).map((group: any) => ({
    updateOne: {
      filter: { userId, subject: group.subject, topic: group.topic },
      update: {
        $inc: {
          totalAttempted: group.attempted,
          totalCorrect: group.correct
        },
        $set: { lastAttemptedAt: new Date() }
      },
      upsert: true
    }
  }));

  if (ops.length === 0) return;

  // Execute bulk increment
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  await UserTopicStat.bulkWrite(ops.map(op => ({
    updateOne: {
      ...op.updateOne,
      filter: { ...op.updateOne.filter, userId: userObjectId }
    }
  })));

  // Recalculate accuracy for the affected topics of this user
  const subjects = Object.values(topicGroups).map((g: any) => g.subject);
  const topics = Object.values(topicGroups).map((g: any) => g.topic);

  await UserTopicStat.updateMany(
    { userId: userObjectId, subject: { $in: subjects }, topic: { $in: topics } },
    [
      {
        $set: {
          accuracyPct: {
            $round: [
              {
                $cond: [
                  { $gt: ["$totalAttempted", 0] },
                  { $multiply: [{ $divide: ["$totalCorrect", "$totalAttempted"] }, 100] },
                  0
                ]
              },
              1 // Round to 1 decimal place
            ]
          }
        }
      }
    ]
  );
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
