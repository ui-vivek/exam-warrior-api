import { Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';
import { getReferralOverview } from '@/services/referralService';

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
