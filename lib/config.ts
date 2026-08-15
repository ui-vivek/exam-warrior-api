import path from 'path';

const dotenv = require('dotenv') as typeof import('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
  quiet: true,
});

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Fail fast in production rather than silently falling back to a well-known
// default. The dev fallbacks below are placeholders only — if they were ever
// used to sign a real token, anyone reading this (public) source could forge a
// JWT for any user.
if (isProduction) {
  const required = ['JWT_SECRET', 'REFRESH_SECRET', 'MONGODB_URI'] as const;
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) in production: ${missing.join(', ')}. ` +
        'Set them in your host dashboard (Render → Environment) before starting the server.'
    );
  }
}

export const env = {
  nodeEnv,
  // Single source of truth for prod-only behaviour (auth gates, rate limiting,
  // response caching). In development these stay off so local testing is
  // unthrottled and open.
  isProduction,
  port: Number(process.env.PORT) || 5050,
  mongoUri: process.env.MONGODB_URI || '',
  // Dev-only fallbacks. Production is guaranteed to have the real values by the
  // fail-fast check above, so these strings can never reach a live token.
  jwtSecret: process.env.JWT_SECRET || 'dev_only_jwt_secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m', // Access token short-lived
  refreshSecret: process.env.REFRESH_SECRET || 'dev_only_refresh_secret',
  refreshExpiresIn: process.env.REFRESH_EXPIRES_IN || '7d', // Refresh token long-lived
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY || '',
    senderId: process.env.MSG91_SENDER_ID || '',
    templateId: process.env.MSG91_TEMPLATE_ID || '',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    verifySid: process.env.TWILIO_VERIFY_SID || '',
  },
};
