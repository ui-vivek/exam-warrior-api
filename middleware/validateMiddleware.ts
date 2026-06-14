import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';
import { AppError } from '@/utils/AppError';

export const validate = (schema: ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as any;
      req.body = parsed.body;
      Object.defineProperty(req, 'query', {
        value: parsed.query,
        writable: true,
        enumerable: true,
        configurable: true
      });
      req.params = parsed.params;
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Grab the first validation issue message
        const firstError = error.issues[0];
        const errorMessage = firstError ? firstError.message : 'Validation failed';
        next(new AppError(errorMessage, 400));
      } else {
        next(error);
      }
    }
  };
};
