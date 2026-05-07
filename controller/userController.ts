import { type Request, type Response } from 'express';
import { getUsers, updateUserExamType } from '@/services/userService';
import { AuthRequest } from '@/middleware/authMiddleware';
import { asyncHandler } from '@/utils/asyncHandler';

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const users = await getUsers();
  res.status(200).json({
    success: true,
    message: 'Users fetched successfully',
    data: users,
  });
});

export const updateExamType = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { examType } = req.body;
  const validTypes = ['SSC', 'RAILWAY', 'BANKING', 'UPSC'];
  
  if (!validTypes.includes(examType)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid exam type' 
    });
  }

  const user = await updateUserExamType(req.userId!, examType);
  
  res.status(200).json({ 
    success: true, 
    message: 'Exam type updated successfully',
    data: user 
  });
});
