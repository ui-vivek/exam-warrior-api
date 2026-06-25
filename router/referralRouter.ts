import { getMyReferral, validateCode, applyCode } from '@/controller/referralController';
import { authMiddleware } from '@/middleware/authMiddleware';
import { validate } from '@/middleware/validateMiddleware';
import { applyReferralSchema } from '@/validators/referralValidator';

const express = require('express') as typeof import('express');
const router = express.Router();

router.get('/me', authMiddleware, getMyReferral);
router.get('/validate', authMiddleware, validateCode);
router.post('/apply', authMiddleware, validate(applyReferralSchema), applyCode);

export default router;
