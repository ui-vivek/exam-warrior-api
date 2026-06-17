import { getTodayTest, createPracticeTest, getPracticeSubjects, submitTest, getTestReview, getTestHistory } from '@/controller/testController';
import { authMiddleware } from '@/middleware/authMiddleware';
import { subscriptionMiddleware } from '@/middleware/subscriptionMiddleware';
const express = require('express') as typeof import('express');

const router = express.Router();

router.get('/today', authMiddleware, subscriptionMiddleware, getTodayTest);
router.get('/practice/subjects', authMiddleware, getPracticeSubjects);
router.post('/practice', authMiddleware, subscriptionMiddleware, createPracticeTest);
router.get('/history', authMiddleware, getTestHistory);
router.post('/:id/submit', authMiddleware, submitTest);
router.get('/:id/review', authMiddleware, getTestReview);

export default router;
