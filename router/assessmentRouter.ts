import {
  createAssessment,
  listBatchAssessments,
  getAssessment,
  cancelAssessment,
  getAssessmentAnalytics,
  startAssessment,
  submitAssessment,
  getAssessmentLeaderboard,
  getAssessmentReview,
} from '@/controller/assessmentController';
import { authMiddleware } from '@/middleware/authMiddleware';
import { validate } from '@/middleware/validateMiddleware';
import { createAssessmentSchema, submitAssessmentSchema } from '@/validators/assessmentValidator';

const express = require('express') as typeof import('express');

const router = express.Router();

// Literal paths first so they aren't captured by '/:id'.
router.post('/', authMiddleware, validate(createAssessmentSchema), createAssessment);
router.get('/batch/:batchId', authMiddleware, listBatchAssessments);

router.get('/:id', authMiddleware, getAssessment);
router.post('/:id/cancel', authMiddleware, cancelAssessment);
router.get('/:id/analytics', authMiddleware, getAssessmentAnalytics);

router.post('/:id/start', authMiddleware, startAssessment);
router.post('/:id/submit', authMiddleware, validate(submitAssessmentSchema), submitAssessment);
router.get('/:id/leaderboard', authMiddleware, getAssessmentLeaderboard);
router.get('/:id/review', authMiddleware, getAssessmentReview);

export default router;
