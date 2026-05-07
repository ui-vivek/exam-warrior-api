import { Request, Response } from 'express';
import { AuthService } from '@/services/authService';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';

export const requestOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone) {
    throw new AppError('Phone number is required', 400);
  }

  const result = await AuthService.requestOtp(phone);
  res.status(200).json({ 
    success: true, 
    message: result.message,
    data: {} 
  });
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) {
    throw new AppError('Phone and OTP are required', 400);
  }

  const result = await AuthService.verifyAndLogin(phone, otp);
  res.status(200).json({
    success: true,
    message: 'Logged in successfully',
    data: result
  });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400);
  }

  const result = await AuthService.refreshAccessToken(refreshToken);
  res.status(200).json({
    success: true,
    message: 'Token refreshed successfully',
    data: result
  });
});
