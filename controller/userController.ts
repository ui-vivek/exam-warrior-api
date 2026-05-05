import { type Request, type Response } from 'express';

import { getUsers } from '@/services/userService';

export function listUsers(req: Request, res: Response) {
  res.status(200).json({
    success: true,
    data: getUsers(),
  });
}
