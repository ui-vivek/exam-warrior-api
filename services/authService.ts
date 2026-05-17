import jwt from 'jsonwebtoken';
import { env } from '@/lib/config';
import { User } from '@/model/user.model';
import { OtpService } from './otpService';
import { AppError } from '@/utils/AppError';

export class AuthService {
  static async requestOtp(phone: string) {
    const result = await OtpService.sendOtp(phone);
    if (!result.success) {
      const statusCode = (result.code === 'RATE_LIMIT' || result.code === 'ACCOUNT_LOCKED') ? 429 : 400;
      throw new AppError(result.message, statusCode);
    }
    return { message: result.message };
  }

  static async verifyAndLogin(phone: string, otp: string, preferredLanguage?: string) {
    const isValid = await OtpService.verifyOtp(phone, otp);
    if (!isValid) {
      throw new AppError('Invalid or expired OTP', 401);
    }

    let user = await User.findOne({ phone });
    let isNewUser = false;

    if (!user) {
      user = await User.create({
        phone,
        subscriptionStatus: 'trial',
        trialStartDate: new Date(),
        examType: 'SSC',
        preferredLanguage: (preferredLanguage === 'hindi' ? 'hindi' : 'english')
      });
      isNewUser = true;
    } else if (preferredLanguage === 'english' || preferredLanguage === 'hindi') {
      user.preferredLanguage = preferredLanguage;
    }

    const tokens = this.generateTokens(user._id.toString(), user.phone);
    
    // Save refresh token to user
    user.refreshToken = tokens.refreshToken;
    await user.save();

    return {
      ...tokens,
      user,
      isNewUser
    };
  }

  static async refreshAccessToken(refreshToken: string) {
    try {
      const decoded = jwt.verify(refreshToken, env.refreshSecret) as { userId: string };
      const user = await User.findById(decoded.userId);

      if (!user || user.refreshToken !== refreshToken) {
        throw new AppError('Invalid refresh token', 401);
      }

      const tokens = this.generateTokens(user._id.toString(), user.phone);
      
      // Update refresh token (Rotation)
      user.refreshToken = tokens.refreshToken;
      await user.save();

      return tokens;
    } catch (error: any) {
      throw new AppError('Token refresh failed', 401);
    }
  }

  private static generateTokens(userId: string, phone: string) {
    const accessToken = jwt.sign(
      { userId, phone },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn as any }
    );

    const refreshToken = jwt.sign(
      { userId },
      env.refreshSecret,
      { expiresIn: env.refreshExpiresIn as any }
    );

    return { accessToken, refreshToken };
  }
}
