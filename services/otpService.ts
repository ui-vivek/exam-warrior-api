import bcrypt from 'bcrypt';
import twilio from 'twilio';
import { env } from '@/lib/config';
import { OtpStore } from '@/model/otpStore.model';

export class OtpService {
  private static DUMMY_OTP = '123456';
  private static DUMMY_NUMBERS = ['1111111111', '2222222222', '3333333333', '4444444444', '5555555555', '6666666666', '7777777777', '8888888888', '9999999999', '0000000000'];

  static async sendOtp(phone: string): Promise<{ success: boolean; message: string; code?: string }> {
    const isDummy = this.DUMMY_NUMBERS.includes(phone);

    // 1. Validate phone
    if (!isDummy && !/^[6-9]\d{9}$/.test(phone)) {
      return { success: false, message: 'Please enter a valid 10-digit phone number', code: 'INVALID_PHONE' };
    }

    // 2. Rate limit: max 3 OTPs per phone per 5 minutes
    const recentOtps = await OtpStore.countDocuments({
      phone,
      createdAt: { $gte: new Date(Date.now() - 300000) } 
    });
    
    if (recentOtps >= 3) {
      return { 
        success: false, 
        message: 'You have requested too many OTPs. Please wait 5 minutes before trying again.', 
        code: 'RATE_LIMIT' 
      };
    }

    if (isDummy) {
      const otpHash = await bcrypt.hash(this.DUMMY_OTP, 10);
      await OtpStore.deleteMany({ phone }); 
      await OtpStore.create({
        phone,
        otpHash,
        attempts: 0,
        expiresAt: new Date(Date.now() + 600000),
      });
      console.log(`[DUMMY AUTH] OTP for ${phone} is ${this.DUMMY_OTP}`);
      return { success: true, message: 'OTP sent successfully' };
    }

    // 3. Tracking in Database
    await OtpStore.create({
      phone,
      otpHash: 'MANAGED_BY_TWILIO',
      attempts: 0,
      expiresAt: new Date(Date.now() + 600000),
    });

    // 4. Send via Twilio Verify
    const sent = await this.sendViaTwilioVerify(phone);

    if (!sent) {
      return { success: false, message: 'Failed to send SMS. Please try again later.', code: 'SMS_ERROR' };
    }

    return { success: true, message: 'OTP sent successfully' };
  }

  private static async sendViaTwilioVerify(phone: string): Promise<boolean> {
    try {
      const { accountSid, authToken, verifySid } = env.twilio;
      if (!accountSid || !authToken || !verifySid || accountSid.includes('your_')) {
        console.error('Twilio credentials or Verify SID missing or invalid');
        return false;
      }

      const client = twilio(accountSid, authToken);
      await client.verify.v2.services(verifySid)
        .verifications
        .create({ to: `+91${phone}`, channel: 'sms' });

      return true;
    } catch (error: any) {
      console.error('Error sending Twilio Verify OTP:', error.message);
      return false;
    }
  }

  static async verifyOtp(phone: string, otp: string): Promise<boolean> {
    if (this.DUMMY_NUMBERS.includes(phone)) {
      if (otp === this.DUMMY_OTP) {
        await OtpStore.deleteMany({ phone });
        return true;
      }
      return false;
    }

    try {
      const { accountSid, authToken, verifySid } = env.twilio;
      if (accountSid && authToken && verifySid && !accountSid.includes('your_')) {
        const client = twilio(accountSid, authToken);
        const check = await client.verify.v2.services(verifySid)
          .verificationChecks
          .create({ to: `+91${phone}`, code: otp });
        
        if (check.status === 'approved') {
          await OtpStore.deleteMany({ phone });
          return true;
        } else {
          // If verification fails, increment attempts in our DB for tracking
          await OtpStore.findOneAndUpdate(
            { phone, otpHash: 'MANAGED_BY_TWILIO' }, 
            { $inc: { attempts: 1 } },
            { sort: { createdAt: -1 } }
          );
        }
      }
    } catch (error: any) {
      console.error('Error verifying Twilio OTP:', error.message);
    }

    return false;
  }
}
