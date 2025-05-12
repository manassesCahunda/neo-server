import { Redis } from 'ioredis'
import { env } from '../../env'

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 50,
  retryStrategy: (times) => {
    return Math.min(times * 100, 3000); 
  },
});
