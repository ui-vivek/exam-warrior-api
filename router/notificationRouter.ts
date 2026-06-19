import { cronDailyReminder } from '@/controller/deviceController';

const express = require('express') as typeof import('express');

const router = express.Router();

// Triggered by an external scheduler (cron-job.org / GitHub Actions / UptimeRobot).
// Auth is via the x-cron-secret header (no user session).
router.post('/cron/daily-reminder', cronDailyReminder);

export default router;
