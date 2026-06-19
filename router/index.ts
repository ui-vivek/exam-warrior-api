import healthRouter from '@/router/healthRouter';
import userRouter from '@/router/userRouter';
import authRouter from '@/router/authRouter';
import aiRouter from '@/router/aiRouter';
import questionRouter from '@/router/questionRouter';
import testRouter from '@/router/testRouter';
import paymentRouter from '@/router/paymentRouter';
import roomRouter from '@/router/roomRouter';
import deviceRouter from '@/router/deviceRouter';

const express = require('express') as typeof import('express');

const router = express.Router();

router.use('/health', healthRouter);
router.use('/users', userRouter);
router.use('/auth', authRouter);
router.use('/ai', aiRouter);
router.use('/questions', questionRouter);
router.use('/tests', testRouter);
router.use('/payments', paymentRouter);
router.use('/rooms', roomRouter);
router.use('/devices', deviceRouter);

export default router;
