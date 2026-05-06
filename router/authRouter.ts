import { Router } from 'express';
import { requestOtp, verifyOtp } from '@/controller/authController';

const router = Router();

router.post('/send-otp', requestOtp);
router.post('/verify-otp', verifyOtp);

export default router;
