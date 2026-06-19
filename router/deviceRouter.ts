import { registerDevice, unregisterDevice, sendTestPush } from '@/controller/deviceController';
import { authMiddleware } from '@/middleware/authMiddleware';

const express = require('express') as typeof import('express');

const router = express.Router();

router.post('/register', authMiddleware, registerDevice);
router.post('/unregister', authMiddleware, unregisterDevice);
router.post('/test-push', authMiddleware, sendTestPush);

export default router;
