import { Request, Response, NextFunction } from 'express';
import { env } from '@/lib/config';

/**
 * Dependency-free, in-memory fixed-window rate limiter.
 *
 * Enforced ONLY in production (env.isProduction); in development it is a no-op so
 * local testing / OTP retries are never throttled. The API is a single instance,
 * so per-process counters are sufficient; a multi-instance deployment should move
 * this to a shared store (e.g. Redis).
 */
interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;            // window length in ms
  max: number;                 // max requests per key per window
  message?: string;            // 429 body message
  keyGenerator?: (req: Request) => string; // defaults to client IP
}

export const rateLimit = (opts: RateLimitOptions) => {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    // Disabled outside production so development stays unthrottled.
    if (!env.isProduction) return next();

    const now = Date.now();

    // Opportunistic cleanup so the map can't grow unbounded.
    if (buckets.size > 10000) {
      for (const [k, b] of buckets) {
        if (now > b.resetAt) buckets.delete(k);
      }
    }

    const key = (opts.keyGenerator ? opts.keyGenerator(req) : req.ip) || 'unknown';
    let bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        message: opts.message || 'Too many requests. Please try again later.',
        code: 'RATE_LIMITED',
      });
    }

    next();
  };
};
