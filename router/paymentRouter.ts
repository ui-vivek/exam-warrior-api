import { Request, Response } from 'express';
import { User } from '@/model/user.model';
import { authMiddleware } from '@/middleware/authMiddleware';
const express = require('express') as typeof import('express');

const router = express.Router();

router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({
      success: true,
      data: {
        status: user.subscriptionStatus,
        expiryDate: user.subscriptionEndDate
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
