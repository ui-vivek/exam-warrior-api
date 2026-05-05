import { type NextFunction, type Request, type Response } from 'express';

export function notFoundHandler(req: Request, res: Response, next: NextFunction) {
  res.status(404);
  next(new Error(`Route not found: ${req.originalUrl}`));
}

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
  });
}
