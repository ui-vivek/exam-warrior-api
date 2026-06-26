import { getLeague, cronProcessLeagues } from '@/controller/leagueController';
import { authMiddleware } from '@/middleware/authMiddleware';

const express = require('express') as typeof import('express');

const router = express.Router();

router.get('/me', authMiddleware, getLeague);
// Secret-protected (no user session) — for the scheduler / Postman.
router.post('/cron/process', cronProcessLeagues);

export default router;
