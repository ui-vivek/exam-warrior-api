import { z } from 'zod';

export const applyReferralSchema = z.object({
  body: z.object({
    code: z.string().trim().min(1, 'Referral code is required').max(20),
    device_id: z.string().max(128).optional(),
  }),
});

export type ApplyReferralInput = z.infer<typeof applyReferralSchema>['body'];
