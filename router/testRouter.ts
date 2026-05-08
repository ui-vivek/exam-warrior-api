import { getTodayTest, submitTest } from '@/controller/testController';
import { authMiddleware } from '@/middleware/authMiddleware';
import { subscriptionMiddleware } from '@/middleware/subscriptionMiddleware';
const express = require('express') as typeof import('express');

const router = express.Router();

router.get('/today', authMiddleware, subscriptionMiddleware, getTodayTest);
router.post('/:id/submit', authMiddleware, submitTest);

export default router;
