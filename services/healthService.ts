import { env } from '@/lib/config';

export function getHealthStatus() {
  return {
    success: true,
    status: 'ok',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
  };
}
