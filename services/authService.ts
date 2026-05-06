import jwt from 'jsonwebtoken';
import { env } from '@/lib/config';
import { User } from '@/model/user.model';
import { OtpService } from './otpService';

export class AuthService {
  static async requestOtp(phone: string) {
    const result = await OtpService.sendOtp(phone);
    if (!result.success) {
      const error: any = new Error(result.message);
      error.code = result.code;
      throw error;
    }
    return { message: result.message };
  }

  static async verifyAndLogin(phone: string, otp: string) {
    try {
      const isValid = await OtpService.verifyOtp(phone, otp);
      if (!isValid) {
        throw new Error('Invalid or expired OTP');
      }

      // Find or Create User
      let user = await User.findOne({ phone });
      let isNewUser = false;

      if (!user) {
        user = await User.create({
          phone,
          subscriptionStatus: 'trial',
          trialStartDate: new Date(),
          examType: 'SSC' // Default as seen in screenshots
        });
        isNewUser = true;
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user._id.toString(), phone: user.phone },
        env.jwtSecret as string,
        { expiresIn: env.jwtExpiresIn as any }
      );

      return {
        success: true,
        token,
        user,
        isNewUser
      };
    } catch (error: any) {
      throw error; // Re-throw to be handled by controller
    }
  }
}
