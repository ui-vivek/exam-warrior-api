import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import {
  sendStreakSaverReminders,
  sendWeakTopicNudges,
  sendTrialEndingReminders,
  sendRankMovementNotifications,
} from '@/services/notificationService';

/**
 * Secret-protected notification trigger endpoints. They let an external
 * scheduler (cron-job.org / UptimeRobot) — or you, via Postman — fire each job
 * on demand. Same in-server jobs run automatically via lib/cron.ts.
 * Header required: x-cron-secret: <CRON_SECRET>.
 */

const assertCronSecret = (req: Request) => {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    throw new AppError('unauthorized', 401);
  }
};

export const cronStreakSaver = asyncHandler(async (req: Request, res: Response) => {
  assertCronSecret(req);
  const result = await sendStreakSaverReminders();
  res.json({ success: true, data: result });
});

export const cronWeakTopic = asyncHandler(async (req: Request, res: Response) => {
  assertCronSecret(req);
  const result = await sendWeakTopicNudges();
  res.json({ success: true, data: result });
});

export const cronTrialCheck = asyncHandler(async (req: Request, res: Response) => {
  assertCronSecret(req);
  const result = await sendTrialEndingReminders();
  res.json({ success: true, data: result });
});

export const cronRankMovement = asyncHandler(async (req: Request, res: Response) => {
  assertCronSecret(req);
  const result = await sendRankMovementNotifications();
  res.json({ success: true, data: result });
});
