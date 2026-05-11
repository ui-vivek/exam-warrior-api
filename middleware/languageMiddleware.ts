import { Request, Response, NextFunction } from 'express';

export interface LangRequest extends Request {
  lang?: string;
  userId?: string;
}

export const languageMiddleware = (req: LangRequest, res: Response, next: NextFunction) => {
  const lang = req.headers['accept-language'] || 'en';
  // Standardize to 'en' or 'hi'
  req.lang = lang.toLowerCase().startsWith('hi') ? 'hi' : 'en';
  next();
};
