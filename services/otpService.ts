import bcrypt from 'bcrypt';
import twilio from 'twilio';
import { env } from '@/lib/config';
import { OtpStore } from '@/model/otpStore.model';

export class OtpService {
  private static DUMMY_OTP = '123456';
  private static DUMMY_NUMBERS = ['1111111111', '2222222222', '3333333333', '4444444444', '5555555555', '6666666666', '7777777777', '8888888888', '9999999999', '0000000000'];

  static async sendOtp(phone: string): Promise<{ success: boolean; message: string; code?: string }> {
    const isDummy = this.DUMMY_NUMBERS.includes(phone);

    // 1. Validate phone (Skip for dummy)
    if (!isDummy && !/^[6-9]\d{9}$/.test(phone)) {
      return { success: false, message: 'Sahi 10-digit phone number daalein', code: 'INVALID_PHONE' };
    }

    // 2. Check for Account Lockout
    const existingLock = await OtpStore.findOne({ 
      phone, 
      lockedUntil: { $gt: new Date() } 
    });

    if (existingLock) {
      const minutesLeft = Math.ceil((existingLock.lockedUntil!.getTime() - Date.now()) / 60000);
      return { 
        success: false, 
        message: `Bahut zyada galat attempts. ${minutesLeft} minute baad try karein.`,
        code: 'ACCOUNT_LOCKED'
      };
    }

    // 3. Rate limit (Skip for dummy)
    if (!isDummy) {
      // Max 3 OTPs per phone per hour (matches issue #4 Definition of Done).
      const recentOtps = await OtpStore.countDocuments({
        phone,
        createdAt: { $gte: new Date(Date.now() - 3600000) }
      });

      if (recentOtps >= 3) {
        return {
          success: false,
          message: '1 ghante mein sirf 3 OTP bhej sakte hain. Thodi der baad try karein.',
          code: 'RATE_LIMIT'
        };
      }
    }

    // 4. Handle Dummy Login
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
      return { success: true, message: 'OTP bhej diya gaya hai' };
    }

    // 5. Tracking in Database for real numbers
    await OtpStore.create({
      phone,
      otpHash: 'MANAGED_BY_TWILIO',
      attempts: 0,
      expiresAt: new Date(Date.now() + 600000),
    });

    // 6. Send via Twilio Verify
    const sent = await this.sendViaTwilioVerify(phone);

    if (!sent) {
      return { success: false, message: 'OTP bhejne mein dikkat aayi. Thodi der baad try karein.', code: 'SMS_ERROR' };
    }

    return { success: true, message: 'OTP bhej diya gaya hai' };
  }

  private static async sendViaTwilioVerify(phone: string): Promise<boolean> {
    try {
      const { accountSid, authToken, verifySid } = env.twilio;
      if (!accountSid || !authToken || !verifySid || accountSid.includes('your_')) {
        console.error('Twilio credentials missing or invalid');
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
    // 0. Check lockout first
    const existingLock = await OtpStore.findOne({ 
      phone, 
      lockedUntil: { $gt: new Date() } 
    });

    if (existingLock) {
      const error: any = new Error('Account thodi der ke liye lock hai. Baad mein try karein.');
      error.code = 'ACCOUNT_LOCKED';
      throw error;
    }

    // 1. Handle Dummy Verification
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
          // Increment attempts and check for lockout
          const updatedRecord = await OtpStore.findOneAndUpdate(
            { phone, otpHash: 'MANAGED_BY_TWILIO' }, 
            { $inc: { attempts: 1 } },
            { sort: { createdAt: -1 }, new: true }
          );

          if (updatedRecord && updatedRecord.attempts >= 5) {
            await OtpStore.updateOne(
              { _id: updatedRecord._id },
              { $set: { lockedUntil: new Date(Date.now() + 1800000) } } 
            );
            const error: any = new Error('Bahut zyada galat OTP. 30 minute baad try karein.');
            error.code = 'ACCOUNT_LOCKED';
            throw error;
          }
        }
      }
    } catch (error: any) {
      if (error.code === 'ACCOUNT_LOCKED') throw error;
      console.error('Error verifying Twilio OTP:', error.message);
    }

    return false;
  }
}
