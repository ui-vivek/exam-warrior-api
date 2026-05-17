import { Request, Response } from 'express';
import { AuthService } from '@/services/authService';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { getMessage } from '@/utils/messages';
import { LangRequest } from '@/middleware/languageMiddleware';

export const requestOtp = asyncHandler(async (req: LangRequest, res: Response) => {
  const { phone } = req.body;
  if (!phone) {
    throw new AppError('phone_required', 400);
  }

  const result = await AuthService.requestOtp(phone);
  res.status(200).json({ 
    success: true, 
    message: result.message,
    data: {} 
  });
});

export const verifyOtp = asyncHandler(async (req: LangRequest, res: Response) => {
  const { phone, otp, preferred_language } = req.body;
  if (!phone || !otp) {
    throw new AppError('phone_otp_required', 400);
  }

  const result = await AuthService.verifyAndLogin(phone, otp, preferred_language);
  res.status(200).json({
    success: true,
    message: getMessage('logged_in', req.lang),
    data: result
  });
});

export const refreshToken = asyncHandler(async (req: LangRequest, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    throw new AppError('token_required', 400);
  }

  const result = await AuthService.refreshAccessToken(refreshToken);
  res.status(200).json({
    success: true,
    message: getMessage('token_refreshed', req.lang),
    data: result
  });
});
