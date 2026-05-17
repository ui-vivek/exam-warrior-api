import { listUsers, updateExamType, updateLanguage, updateProfile, getUserStats, getWeakTopics, getSubjectStats } from '@/controller/userController';
import { authMiddleware } from '@/middleware/authMiddleware';
import { validate } from '@/middleware/validateMiddleware';
import { updateProfileSchema, updateLanguageSchema, updateExamTypeSchema } from '@/validators/userValidator';

const express = require('express') as typeof import('express');
const router = express.Router();

router.get('/', listUsers);
router.get('/stats', authMiddleware, getUserStats);
router.get('/weak-topics', authMiddleware, getWeakTopics);
router.get('/subject-stats', authMiddleware, getSubjectStats);
router.put('/exam-type', authMiddleware, validate(updateExamTypeSchema), updateExamType);
router.put('/language', authMiddleware, validate(updateLanguageSchema), updateLanguage);
router.put('/profile', authMiddleware, validate(updateProfileSchema), updateProfile);

export default router;
