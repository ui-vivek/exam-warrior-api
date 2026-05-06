import { type Request, type Response } from 'express';

import { getUsers } from '@/services/userService';

export async function listUsers(req: Request, res: Response) {
  try {
    const users = await getUsers();
    res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      data: users,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
      data: {}
    });
  }
}
