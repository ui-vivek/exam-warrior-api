import cron from 'node-cron';
import {
  sendStreakSaverReminders,
  sendWeakTopicNudges,
  sendTrialEndingReminders,
  sendRankMovementNotifications,
  sendReferralNudges,
} from '@/services/notificationService';
import { finalizeExpiredRooms } from '@/services/roomService';
import { processLeagues } from '@/services/leagueService';

/**
 * In-server scheduled jobs (node-cron). They run inside the web service, so on
 * Render's free plan they only fire while the service is awake — keep it alive
 * with an uptime pinger (e.g. UptimeRobot every ~5 min).
 *
 * Master switch:
 *  - ENABLE_CRON=true → turn the scheduler on (off by default).
 *
 * NOTE: the DAILY "today's test is ready" reminder is intentionally NOT here.
 * It's an on-device (local) notification scheduled by the app at each user's own
 * chosen time (Profile → Notifications), so it respects the user's preference and
 * works offline. The server only runs jobs that need server-side data the phone
 * can't compute. (The /notifications/cron/daily-reminder HTTP endpoint still
 * exists for a manual all-users broadcast if ever needed.)
 *
 * Each job's schedule is env-overridable (standard cron syntax). Times are in
 * CRON_TZ (default Asia/Kolkata). Defaults suit Indian aspirants' daily rhythm.
 *  - CRON_STREAK_TIME    '0 20 * * *'      → 8:00 PM  "don't break your streak"
 *  - CRON_WEAKTOPIC_TIME '0 17 * * 1,3,5'  → 5 PM Mon/Wed/Fri  weak-topic drill
 *  - CRON_TRIAL_TIME     '30 10 * * *'     → 10:30 AM trial ending / ended
 *  - CRON_RANK_TIME      '0 18 * * 0'      → 6 PM Sunday  weekly rank movement
 *  - CRON_REFERRAL_TIME  '0 19 * * 6'      → 7 PM Saturday  refer-for-premium nudge
 *
 * For a quick test set any to '*​/2 * * * *' (every 2 min), watch the logs,
 * then revert it to the real time.
 */

type Job = {
  envKey: string;
  defaultSchedule: string;
  label: string;
  run: () => Promise<unknown>;
  // High-frequency jobs: skip the "firing" log and only log "done" when they
  // actually did something, so the logs don't fill with empty runs.
  quiet?: boolean;
};

const JOBS: Job[] = [
  { envKey: 'CRON_STREAK_TIME', defaultSchedule: '0 20 * * *', label: 'streak-saver', run: sendStreakSaverReminders },
  { envKey: 'CRON_WEAKTOPIC_TIME', defaultSchedule: '0 17 * * 1,3,5', label: 'weak-topic', run: sendWeakTopicNudges },
  { envKey: 'CRON_TRIAL_TIME', defaultSchedule: '30 10 * * *', label: 'trial-check', run: sendTrialEndingReminders },
  { envKey: 'CRON_RANK_TIME', defaultSchedule: '0 18 * * 0', label: 'rank-movement', run: sendRankMovementNotifications },
  // Weekly "earn premium free by referring" nudge to free users (language-aware).
  { envKey: 'CRON_REFERRAL_TIME', defaultSchedule: '0 19 * * 6', label: 'referral-nudge', run: sendReferralNudges },
  // Closes rooms whose shared timer ran out (auto-submits no-shows). Runs often.
  { envKey: 'CRON_ROOM_FINALIZE_TIME', defaultSchedule: '* * * * *', label: 'finalize-rooms', run: finalizeExpiredRooms, quiet: true },
  // Weekly league promote/demote — Monday 00:30 IST.
  { envKey: 'CRON_LEAGUE_TIME', defaultSchedule: '30 0 * * 1', label: 'league-weekly', run: processLeagues },
];

export const startCron = (): void => {
  if (process.env.ENABLE_CRON !== 'true') {
    console.log('[Cron] Disabled (set ENABLE_CRON=true to enable).');
    return;
  }

  const timezone = process.env.CRON_TZ || 'Asia/Kolkata';

  for (const job of JOBS) {
    const schedule = process.env[job.envKey] || job.defaultSchedule;
    if (!cron.validate(schedule)) {
      console.error(`[Cron] Invalid ${job.envKey}: "${schedule}" — ${job.label} not scheduled.`);
      continue;
    }

    cron.schedule(
      schedule,
      async () => {
        if (!job.quiet) {
          console.log(`[Cron] ${job.label} firing at ${new Date().toISOString()}`);
        }
        try {
          const result = await job.run();
          const resultStr = JSON.stringify(result);
          // Quiet jobs log only when they did real work (any non-zero count).
          if (!job.quiet || /[1-9]/.test(resultStr || '')) {
            console.log(`[Cron] ${job.label} done:`, resultStr);
          }
        } catch (e) {
          console.error(`[Cron] ${job.label} failed:`, (e as Error).message);
        }
      },
      { timezone },
    );

    console.log(`[Cron] Scheduled ${job.label} at "${schedule}" (${timezone}).`);
  }
};
