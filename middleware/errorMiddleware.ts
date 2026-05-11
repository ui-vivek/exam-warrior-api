import { type NextFunction, type Request, type Response } from 'express';
import { AppError } from '@/utils/AppError';
import { getMessage } from '@/utils/messages';
import { LangRequest } from '@/middleware/languageMiddleware';

export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  next(new AppError(`Route not found: ${req.originalUrl}`, 404));
}

export function errorHandler(err: any, req: LangRequest, res: Response, next: NextFunction) {
  const statusCode = err.statusCode || 500;
  const lang = req.lang || 'en';
  
  // Log error for debugging
  console.error('[Error]', err);

  // Translate message if possible
  const translatedMessage = getMessage(err.message, lang);

  res.status(statusCode).json({
    success: false,
    message: translatedMessage,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
}
