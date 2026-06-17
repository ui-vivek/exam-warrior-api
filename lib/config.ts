import path from 'path';

const dotenv = require('dotenv') as typeof import('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
  quiet: true,
});

const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  nodeEnv,
  // Single source of truth for prod-only behaviour (auth gates, rate limiting,
  // response caching). In development these stay off so local testing is
  // unthrottled and open.
  isProduction: nodeEnv === 'production',
  port: Number(process.env.PORT) || 5050,
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m', // Access token short-lived
  refreshSecret: process.env.REFRESH_SECRET || 'refresh_secret',
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
