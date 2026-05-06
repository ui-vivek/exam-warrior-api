import path from 'path';

const dotenv = require('dotenv') as typeof import('dotenv');

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
  quiet: true,
});

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5050,
  mongoUri: process.env.MONGODB_URI || '',
  jwtSecret: process.env.JWT_SECRET || 'secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
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
