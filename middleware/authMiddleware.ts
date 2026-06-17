import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@/lib/config';

export interface AuthRequest extends Request {
  userId?: string;
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: true, message: 'Authorization token required' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as { userId: string };
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: true, message: 'Invalid or expired token' });
  }
};

/**
 * Enforces authentication ONLY in production. In development the request passes
 * straight through, so internal/admin endpoints (e.g. listing users, AI
 * question generation) stay open for Postman/seeding while still being locked
 * down once NODE_ENV=production.
 */
export const authInProduction = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!env.isProduction) return next();
  return authMiddleware(req, res, next);
};
