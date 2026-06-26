import { User } from '@/model/user.model';
import { sendPushToUsers } from '@/services/pushService';

/**
 * Achievement badges (status rewards). The server is the source of truth for
 * WHICH badges exist and awards them; the app owns the rich display catalog
 * (icons/colours/descriptions). Here we only need a title per badge (for the
 * "new badge" push) and a priority order (to pick a user's top badge).
 */
export const BADGE_TITLES: Record<string, string> = {
  rank_ai_top10: 'All-India Top 10',
  rank_ai_top100: 'All-India Top 100',
  rank_ai_top1000: 'All-India Top 1000',
  rank_state_topper: 'State Topper',
  rank_state_top10: 'State Top 10',
  streak_7: '7-Day Streak',
  streak_30: '30-Day Streak',
  streak_100: '100-Day Streak',
  perfect_score: 'Perfect Score',
  topic_master: 'Topic Master',
  battle_winner: 'Battle Winner',
};

// Highest-prestige first — used to pick the single badge shown on a leaderboard row.
const BADGE_PRIORITY: string[] = [
  'rank_ai_top10',
  'rank_state_topper',
  'rank_ai_top100',
  'rank_state_top10',
  'rank_ai_top1000',
  'streak_100',
  'perfect_score',
  'battle_winner',
  'topic_master',
  'streak_30',
  'streak_7',
];

/** The single most prestigious badge a user owns (for compact display). */
export const topBadgeOf = (badgeIds: string[]): string | null => {
  const owned = new Set(badgeIds);
  for (const id of BADGE_PRIORITY) {
    if (owned.has(id)) return id;
  }
  return null;
};

/**
 * Grants any of [badgeIds] the user doesn't already have (idempotent) and pushes
 * a "new badge" notification. Safe to call fire-and-forget. Returns the newly
 * awarded ids.
 */
export const awardBadges = async (
  userId: string,
  badgeIds: string[],
): Promise<string[]> => {
  const valid = [...new Set(badgeIds)].filter((id) => BADGE_TITLES[id]);
  if (valid.length === 0) return [];

  const user = await User.findById(userId).select('badges');
  if (!user) return [];

  const owned = new Set(((user as any).badges || []).map((b: any) => b.badgeId));
  const newly = valid.filter((id) => !owned.has(id));
  if (newly.length === 0) return [];

  await User.updateOne(
    { _id: userId },
    { $push: { badges: { $each: newly.map((badgeId) => ({ badgeId, earnedAt: new Date() })) } } },
  );

  const names = newly.map((id) => BADGE_TITLES[id]).join(', ');
  sendPushToUsers([userId.toString()], {
    title: '🏅 New badge unlocked',
    body: `You earned: ${names}. Tap to see your trophies.`,
    data: { type: 'badge' },
    channelId: 'updates',
  }).catch(() => {/* best-effort */});

  return newly;
};

/** Rank-tier badges a user qualifies for from their all-India / state rank. */
export const rankBadges = (allIndiaRank: number | null, stateRank: number | null): string[] => {
  const ids: string[] = [];
  if (allIndiaRank != null) {
    if (allIndiaRank <= 10) ids.push('rank_ai_top10');
    if (allIndiaRank <= 100) ids.push('rank_ai_top100');
    if (allIndiaRank <= 1000) ids.push('rank_ai_top1000');
  }
  if (stateRank != null) {
    if (stateRank === 1) ids.push('rank_state_topper');
    if (stateRank <= 10) ids.push('rank_state_top10');
  }
  return ids;
};

/** Streak milestone badges for a given streak length. */
export const streakBadges = (streak: number): string[] => {
  const ids: string[] = [];
  if (streak >= 7) ids.push('streak_7');
  if (streak >= 30) ids.push('streak_30');
  if (streak >= 100) ids.push('streak_100');
  return ids;
};
