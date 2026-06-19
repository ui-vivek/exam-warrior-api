import { cronDailyReminder } from '@/controller/deviceController';
import {
  cronStreakSaver,
  cronWeakTopic,
  cronTrialCheck,
  cronRankMovement,
} from '@/controller/notificationController';

const express = require('express') as typeof import('express');

const router = express.Router();

// Triggered by an external scheduler (cron-job.org / GitHub Actions / UptimeRobot)
// or manually via Postman. Auth is via the x-cron-secret header (no user session).
router.post('/cron/daily-reminder', cronDailyReminder);
router.post('/cron/streak-saver', cronStreakSaver);
router.post('/cron/weak-topic', cronWeakTopic);
router.post('/cron/trial-check', cronTrialCheck);
router.post('/cron/rank-movement', cronRankMovement);

export default router;
