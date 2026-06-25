import { Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';
import {
  getReferralOverview,
  validateReferralCode,
  applyReferralCode,
} from '@/services/referralService';

/**
 * GET /referrals/me
 * Everything the Refer & Earn screen needs: the user's code, share link +
 * localised message, aggregate stats, and the list of invited friends with
 * their status. The internal lifetime cap is never exposed.
 */
export const getMyReferral = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const data = await getReferralOverview(userId);
  res.status(200).json({ success: true, data });
});

/**
 * GET /referrals/validate?code=XYZ
 * Live check used by the onboarding screen to show ✓ valid / ✗ invalid as the
 * user types a friend's code (and to surface the referrer's name).
 */
export const validateCode = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  const code = String(req.query.code || '');
  const data = await validateReferralCode(code, userId);
  res.status(200).json({ success: true, data });
});

/**
 * POST /referrals/apply  { code, device_id? }
 * Links the (new) user to a referrer from the onboarding screen. Rewards are
 * still granted later, on the friend's first daily test.
 */
export const applyCode = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);

  const { code, device_id } = req.body as { code: string; device_id?: string };
  const ip = req.ip || (req.header('x-forwarded-for') || '').split(',')[0].trim() || undefined;

  const data = await applyReferralCode({ userId, code, deviceId: device_id, ip });
  res.status(200).json({ success: true, data });
});
