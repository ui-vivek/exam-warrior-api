import { UserTopicStat } from '@/model/userTopicStat.model';
import { User } from '@/model/user.model';
import { getTodayIST } from '@/utils/dateHelper';

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
  await UserTopicStat.bulkWrite(ops);

  // Recalculate accuracy for the affected topics of this user
  // We use an aggregation pipeline in updateMany to do this efficiently
  const subjects = Object.values(topicGroups).map((g: any) => g.subject);
  const topics = Object.values(topicGroups).map((g: any) => g.topic);

  await UserTopicStat.updateMany(
    { userId, subject: { $in: subjects }, topic: { $in: topics } },
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
 * Updates user's daily streak
 */
export const updateStreak = async (userId: string) => {
  const today = new Date();
  today.setUTCHours(0,0,0,0);
  
  const user = await User.findById(userId);
  if (!user) return;

  const lastActive = user.lastActiveDate ? new Date(user.lastActiveDate) : null;
  if (lastActive) {
    lastActive.setUTCHours(0,0,0,0);
    
    const diffDays = Math.floor((today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
      // Streak continues
      user.streakCount += 1;
    } else if (diffDays > 1) {
      // Streak broken
      user.streakCount = 1;
    }
    // If diffDays === 0, streak already counted for today
  } else {
    // First time
    user.streakCount = 1;
  }

  user.lastActiveDate = new Date();
  await user.save();
};
