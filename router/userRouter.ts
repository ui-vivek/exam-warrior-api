import { listUsers, updateExamType } from '@/controller/userController';
import { authMiddleware } from '@/middleware/authMiddleware';

const express = require('express') as typeof import('express');
const router = express.Router();

router.get('/', listUsers);

router.put('/exam-type', authMiddleware, updateExamType);

export default router;
