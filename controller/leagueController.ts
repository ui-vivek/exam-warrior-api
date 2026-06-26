import { Request, Response } from 'express';
import { asyncHandler } from '@/utils/asyncHandler';
import { AppError } from '@/utils/AppError';
import { LangRequest } from '@/middleware/languageMiddleware';
import { getMyLeague, processLeagues } from '@/services/leagueService';

/** GET /leagues/me — the user's tier + this week's live division standings. */
export const getLeague = asyncHandler(async (req: LangRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) throw new AppError('unauthorized', 401);
  const data = await getMyLeague(userId);
  res.json({ success: true, data });
});

/**
 * POST /leagues/cron/process — secret-protected weekly processing trigger
 * (promote/demote). Lets you run it from Postman or an external scheduler.
 * Header: x-cron-secret: <CRON_SECRET>.
 */
export const cronProcessLeagues = asyncHandler(async (req: Request, res: Response) => {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    throw new AppError('unauthorized', 401);
  }
  const result = await processLeagues();
  res.json({ success: true, data: result });
});
