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
    let statusCode = 400;
    if (error.code === 'RATE_LIMIT' || error.code === 'ACCOUNT_LOCKED') {
      statusCode = 429;
    }
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
    let statusCode = 400;
    
    // DoD: Wrong OTP -> 401
    if (error.message === 'Invalid or expired OTP') {
      statusCode = 401;
    } else if (error.code === 'ACCOUNT_LOCKED') {
      statusCode = 429; // Too Many Requests
    }

    res.status(statusCode).json({ 
      success: false, 
      message: error.message,
      data: { code: error.code || 'VERIFICATION_FAILED' }
    });
  }
};
