import cron from 'node-cron';
import { sendDailyReminderToAll } from '@/services/pushService';

/**
 * In-server scheduled jobs (node-cron). Runs inside the web service, so on
 * Render's free plan it only fires while the service is awake — keep it alive
 * with an uptime pinger (e.g. UptimeRobot every ~5 min).
 *
 * Env:
 *  - ENABLE_CRON=true        → turn the scheduler on (off by default).
 *  - CRON_DAILY_TIME='0 19 * * *'  → schedule (default 7:00 PM). For a quick
 *    test set it to '*​/2 * * * *' (every 2 min), watch the logs, then revert.
 *  - CRON_TZ='Asia/Kolkata'  → timezone for the schedule.
 */
export const startCron = (): void => {
  if (process.env.ENABLE_CRON !== 'true') {
    console.log('[Cron] Disabled (set ENABLE_CRON=true to enable).');
    return;
  }

  const schedule = process.env.CRON_DAILY_TIME || '0 19 * * *';
  const timezone = process.env.CRON_TZ || 'Asia/Kolkata';

  if (!cron.validate(schedule)) {
    console.error(`[Cron] Invalid CRON_DAILY_TIME: "${schedule}" — cron not started.`);
    return;
  }

  cron.schedule(
    schedule,
    async () => {
      const startedAt = new Date().toISOString();
      console.log(`[Cron] Daily reminder firing at ${startedAt}`);
      try {
        const result = await sendDailyReminderToAll();
        console.log('[Cron] Daily reminder done:', JSON.stringify(result));
      } catch (e) {
        console.error('[Cron] Daily reminder failed:', (e as Error).message);
      }
    },
    { timezone },
  );

  console.log(`[Cron] Scheduled daily reminder at "${schedule}" (${timezone}).`);
};
