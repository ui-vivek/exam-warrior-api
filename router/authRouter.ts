import { Router } from 'express';
import { requestOtp, verifyOtp, refreshToken } from '@/controller/authController';
import { validate } from '@/middleware/validateMiddleware';
import { rateLimit } from '@/middleware/rateLimitMiddleware';
import { sendOtpSchema, verifyOtpSchema, refreshTokenSchema } from '@/validators/authValidator';

const router = Router();

// Per-IP abuse guards on the auth surface (production-only; no-op in dev).
// These sit on top of the existing per-phone OTP rate limit in OtpService.
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many OTP requests. Please try again later.',
});
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Too many attempts. Please try again later.',
});
const refreshLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });

router.post('/send-otp', otpSendLimiter, validate(sendOtpSchema), requestOtp);
router.post('/verify-otp', otpVerifyLimiter, validate(verifyOtpSchema), verifyOtp);
router.post('/refresh-token', refreshLimiter, validate(refreshTokenSchema), refreshToken);

export default router;
