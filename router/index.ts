import healthRouter from '@/router/healthRouter';
import userRouter from '@/router/userRouter';

const express = require('express') as typeof import('express');

const router = express.Router();

router.use('/health', healthRouter);
router.use('/users', userRouter);

export default router;
