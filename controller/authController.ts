import { Request, Response } from 'express';
import { AuthService } from '@/services/authService';

export const requestOtp = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number is required',
        data: { code: 'MISSING_PHONE' }
      });
    }

    const result = await AuthService.requestOtp(phone);
    res.status(200).json({ 
      success: true, 
      message: result.message,
      data: {} 
    });
  } catch (error: any) {
    const statusCode = error.code === 'RATE_LIMIT' ? 429 : 400;
    res.status(statusCode).json({ 
      success: false, 
      message: error.message,
      data: { code: error.code || 'BAD_REQUEST' }
    });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone and OTP are required',
        data: {}
      });
    }

    const result = await AuthService.verifyAndLogin(phone, otp);
    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      data: result
    });
  } catch (error: any) {
    res.status(400).json({ 
      success: false, 
      message: error.message,
      data: {}
    });
  }
};
