import { type Request, type Response } from 'express';

import { getHealthStatus } from '@/services/healthService';

export function getHealth(req: Request, res: Response) {
  res.status(200).json(getHealthStatus());
}
