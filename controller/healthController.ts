import { type Request, type Response } from 'express';

import { getHealthStatus } from '@/services/healthService';

export function getHealth(req: Request, res: Response) {
  const health = getHealthStatus();
  res.status(200).json({
    success: true,
    message: 'Server is healthy',
    data: health
  });
}
