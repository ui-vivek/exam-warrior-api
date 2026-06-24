import { getMyReferral } from '@/controller/referralController';
import { authMiddleware } from '@/middleware/authMiddleware';

const express = require('express') as typeof import('express');
const router = express.Router();

router.get('/me', authMiddleware, getMyReferral);

export default router;
