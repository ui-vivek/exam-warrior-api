import { Router } from 'express';
import { requestOtp, verifyOtp, refreshToken } from '@/controller/authController';
import { validate } from '@/middleware/validateMiddleware';
import { sendOtpSchema, verifyOtpSchema, refreshTokenSchema } from '@/validators/authValidator';

const router = Router();

router.post('/send-otp', validate(sendOtpSchema), requestOtp);
router.post('/verify-otp', validate(verifyOtpSchema), verifyOtp);
router.post('/refresh-token', validate(refreshTokenSchema), refreshToken);

export default router;
