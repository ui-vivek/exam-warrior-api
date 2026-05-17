import { z } from 'zod';

export const sendOtpSchema = z.object({
  body: z.object({
    phone: z.string({
      message: 'phone_required'
    }).min(10, 'phone_required').max(15, 'phone_required')
  })
});

export const verifyOtpSchema = z.object({
  body: z.object({
    phone: z.string({
      message: 'phone_otp_required'
    }).min(10, 'phone_otp_required'),
    otp: z.string({
      message: 'phone_otp_required'
    }).min(4, 'phone_otp_required'),
    preferred_language: z.enum(['english', 'hindi']).optional()
  })
});

export const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string({
      message: 'token_required'
    }).min(1, 'token_required')
  })
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>['body'];
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>['body'];
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>['body'];
