import { Router } from 'express';
import { requestOtp, verifyOtp, refreshToken } from '@/controller/authController';

const router = Router();

router.post('/send-otp', requestOtp);
router.post('/verify-otp', verifyOtp);
router.post('/refresh-token', refreshToken);

export default router;
