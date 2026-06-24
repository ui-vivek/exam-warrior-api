import { Request, Response } from 'express';
import { AuthService } from '@/services/authService';
import { asyncHandler } from '@/utils/asyncHandler';
import { getMessage } from '@/utils/messages';
import { LangRequest } from '@/middleware/languageMiddleware';
import { SendOtpInput, VerifyOtpInput, RefreshTokenInput } from '@/validators/authValidator';

export const requestOtp = asyncHandler(async (req: LangRequest, res: Response) => {
  const { phone } = req.body as SendOtpInput;

  const result = await AuthService.requestOtp(phone);
  res.status(200).json({ 
    success: true, 
    message: result.message,
    data: {} 
  });
});

export const verifyOtp = asyncHandler(async (req: LangRequest, res: Response) => {
  const { phone, otp, preferred_language, referral_code, device_id } = req.body as VerifyOtpInput;

  const deviceId = device_id || (req.header('x-device-id') || undefined);
  const ip = req.ip || (req.header('x-forwarded-for') || '').split(',')[0].trim() || undefined;

  const result = await AuthService.verifyAndLogin(phone, otp, preferred_language, {
    referralCode: referral_code,
    deviceId,
    ip,
  });
  res.status(200).json({
    success: true,
    message: getMessage('logged_in', req.lang),
    data: result
  });
});

export const refreshToken = asyncHandler(async (req: LangRequest, res: Response) => {
  const { refreshToken } = req.body as RefreshTokenInput;

  const result = await AuthService.refreshAccessToken(refreshToken);
  res.status(200).json({
    success: true,
    message: getMessage('token_refreshed', req.lang),
    data: result
  });
});
