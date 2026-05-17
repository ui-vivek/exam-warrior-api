import { listUsers, updateExamType, updateLanguage, getUserStats, getWeakTopics, getSubjectStats } from '@/controller/userController';
import { authMiddleware } from '@/middleware/authMiddleware';

const express = require('express') as typeof import('express');
const router = express.Router();

router.get('/', listUsers);
router.get('/stats', authMiddleware, getUserStats);
router.get('/weak-topics', authMiddleware, getWeakTopics);
router.get('/subject-stats', authMiddleware, getSubjectStats);
router.put('/exam-type', authMiddleware, updateExamType);
router.put('/language', authMiddleware, updateLanguage);

export default router;
