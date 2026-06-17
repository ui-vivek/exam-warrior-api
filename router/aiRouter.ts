import { generateAndSaveQuestions } from '@/controller/aiController';
import { authInProduction } from '@/middleware/authMiddleware';
import { rateLimit } from '@/middleware/rateLimitMiddleware';
const express = require('express') as typeof import('express');

const router = express.Router();

// Expensive (multiple LLM calls). Require auth + rate-limit in production; both
// are no-ops in development so seeding/Postman flows stay open.
const aiGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'AI generation rate limit reached. Please try again later.',
});

router.post('/generate-questions', authInProduction, aiGenerationLimiter, generateAndSaveQuestions);

export default router;
