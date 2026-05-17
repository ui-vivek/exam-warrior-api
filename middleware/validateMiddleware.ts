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
      // Replace properties with parsed, validated, and typed values
      req.body = parsed.body;
      req.query = parsed.query;
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
