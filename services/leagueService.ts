import { User } from '@/model/user.model';
import { Test } from '@/model/test.model';
import { sendPushToUsers } from '@/services/pushService';

/**
 * Weekly leagues (Duolingo-style). Users compete within their tier + exam by
 * score earned in the current league week (Mon–now IST). A weekly cron promotes
 * the top performers and demotes the bottom, so there's always something to play
 * for. Standings are computed live from Test docs (windowed), so nothing needs
 * to be reset — moving past Monday automatically starts a fresh week.
 */

export const LEAGUE_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'] as const;
type Tier = (typeof LEAGUE_TIERS)[number];

const TIER_LABEL: Record<string, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
};

const PROMOTE_COUNT = Number(process.env.LEAGUE_PROMOTE) || 5;
const DEMOTE_COUNT = Number(process.env.LEAGUE_DEMOTE) || 5;

/** Start of an IST league week (Monday 00:00), as a UTC Date. 0 = this week. */
const weekStartIST = (offsetWeeks = 0): Date => {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const shifted = new Date(Date.now() + istOffset);
  const day = shifted.getUTCDay(); // 0=Sun..6=Sat in IST wall-clock
  const diffToMonday = (day + 6) % 7; // days since Monday
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(shifted.getUTCDate() - diffToMonday - offsetWeeks * 7);
  return new Date(shifted.getTime() - istOffset);
};

type Row = { userId: any; name: string; weekScore: number; tests: number };

/** Ranked standings for a tier+exam over [since, until). Includes 0-score users. */
const standingsFor = async (
  tier: Tier,
  examType: string,
  since: Date,
  until?: Date,
): Promise<Row[]> => {
  const users: any[] = await User.find({ leagueTier: tier, examType } as any)
    .select('name')
    .lean();
  if (!users.length) return [];

  const ids = users.map((u) => u._id);
  const match: any = {
    userId: { $in: ids },
    completed: true,
    type: { $ne: 'practice' },
    examType,
    createdAt: { $gte: since },
  };
  if (until) match.createdAt.$lt = until;

  const agg: any[] = await Test.aggregate([
    { $match: match },
    { $group: { _id: '$userId', weekScore: { $sum: '$score' }, tests: { $sum: 1 } } },
  ]);
  const byId = new Map(agg.map((a: any) => [a._id.toString(), a]));

  const rows: Row[] = users.map((u) => ({
    userId: u._id,
    name: u.name && u.name.trim() ? u.name : 'Warrior',
    weekScore: byId.get(u._id.toString())?.weekScore || 0,
    tests: byId.get(u._id.toString())?.tests || 0,
  }));
  rows.sort((a, b) => b.weekScore - a.weekScore || b.tests - a.tests);
  return rows;
};

/** The current user's league + this week's live division standings. */
export const getMyLeague = async (userId: string) => {
  const me: any = await User.findById(userId).select('leagueTier examType').lean();
  const tier = (me?.leagueTier || 'bronze') as Tier;
  const examType = me?.examType || 'SSC';
  const tierIndex = LEAGUE_TIERS.indexOf(tier);

  const rows = await standingsFor(tier, examType, weekStartIST(0));
  const idx = rows.findIndex((r) => r.userId.toString() === userId.toString());

  return {
    tier,
    examType,
    promoteCount: PROMOTE_COUNT,
    demoteCount: DEMOTE_COUNT,
    canPromote: tierIndex < LEAGUE_TIERS.length - 1,
    canDemote: tierIndex > 0,
    myRank: idx >= 0 ? idx + 1 : null,
    total: rows.length,
    standings: rows.slice(0, 30).map((r, i) => ({
      rank: i + 1,
      name: r.name,
      weekScore: r.weekScore,
      tests: r.tests,
      isMe: r.userId.toString() === userId.toString(),
    })),
  };
};

const notifyLeagueMove = (userId: string, tier: Tier, dir: 'up' | 'down') => {
  const label = TIER_LABEL[tier] || tier;
  const payload =
    dir === 'up'
      ? {
          title: `Promoted to ${label} League 🎉`,
          body: 'Great week! You moved up a league. Keep the momentum going.',
        }
      : {
          title: `Moved down to ${label} League`,
          body: 'You slipped a league this week. Take today’s test to climb back.',
        };
  sendPushToUsers([userId], { ...payload, data: { type: 'league' }, channelId: 'updates' }).catch(
    () => {/* best-effort */},
  );
};

/**
 * Weekly job: for each tier+exam, promote the top performers of the week that
 * just ended and demote the bottom. Runs off the previous-week window.
 */
export const processLeagues = async () => {
  const since = weekStartIST(1);
  const until = weekStartIST(0);
  const exams: string[] = await User.distinct('examType');

  const ops: any[] = [];
  let promoted = 0;
  let demoted = 0;

  for (const examType of exams) {
    for (let t = 0; t < LEAGUE_TIERS.length; t++) {
      const tier = LEAGUE_TIERS[t];
      const rows = await standingsFor(tier, examType, since, until);
      if (!rows.length) continue;

      const promotedSet = new Set<string>();

      // Promote the week's top performers (not from the top tier; must have played).
      if (t < LEAGUE_TIERS.length - 1) {
        for (const r of rows.slice(0, PROMOTE_COUNT)) {
          if (r.weekScore <= 0) continue;
          const id = r.userId.toString();
          promotedSet.add(id);
          ops.push({
            updateOne: { filter: { _id: r.userId }, update: { $set: { leagueTier: LEAGUE_TIERS[t + 1] } } },
          });
          promoted += 1;
          notifyLeagueMove(id, LEAGUE_TIERS[t + 1], 'up');
        }
      }

      // Demote the bottom (not from the bottom tier), skipping anyone just
      // promoted and only when the cohort is big enough to have a distinct bottom.
      if (t > 0 && rows.length > PROMOTE_COUNT) {
        for (const r of rows.slice(Math.max(0, rows.length - DEMOTE_COUNT))) {
          const id = r.userId.toString();
          if (promotedSet.has(id)) continue;
          ops.push({
            updateOne: { filter: { _id: r.userId }, update: { $set: { leagueTier: LEAGUE_TIERS[t - 1] } } },
          });
          demoted += 1;
          notifyLeagueMove(id, LEAGUE_TIERS[t - 1], 'down');
        }
      }
    }
  }

  if (ops.length) await User.bulkWrite(ops);
  return { promoted, demoted };
};
