import healthRouter from '@/router/healthRouter';
import userRouter from '@/router/userRouter';
import authRouter from '@/router/authRouter';
import aiRouter from '@/router/aiRouter';

const express = require('express') as typeof import('express');

const router = express.Router();

router.use('/health', healthRouter);
router.use('/users', userRouter);
router.use('/auth', authRouter);
router.use('/ai', aiRouter);

export default router;
