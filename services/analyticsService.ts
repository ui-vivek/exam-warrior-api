import { UserTopicStat } from '@/model/userTopicStat.model';
import { User } from '@/model/user.model';
import { getTodayIST } from '@/utils/dateHelper';

/**
 * Updates topic-wise proficiency for a user after a test
 */
export const updateTopicStats = async (userId: string, answerDocs: any[], questionMap: any) => {
  for (const answer of answerDocs) {
    const q = questionMap[answer.questionId];
    if (!q) continue;

    await UserTopicStat.findOneAndUpdate(
      { userId, subject: q.subject, topic: q.topic },
      {
        $inc: {
          totalAttempted: 1,
          totalCorrect: answer.isCorrect ? 1 : 0
        },
        $set: { lastAttemptedAt: new Date() }
      },
      { upsert: true, new: true }
    ).then(stat => {
        if (stat) {
            const accuracy = (stat.totalCorrect / stat.totalAttempted) * 100;
            stat.accuracyPct = Math.round(accuracy);
            return stat.save();
        }
    });
  }
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
