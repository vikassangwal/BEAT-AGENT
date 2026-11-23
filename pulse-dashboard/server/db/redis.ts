import Redis from 'ioredis';
import { config } from '../config';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisSub: Redis | undefined;
};

export const redis = globalForRedis.redis ?? new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

export const redisSub = globalForRedis.redisSub ?? new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});

if (config.nodeEnv !== 'production') {
  globalForRedis.redis = redis;
  globalForRedis.redisSub = redisSub;
}

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redisSub.on('error', (err) => {
  console.error('Redis subscription connection error:', err);
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
  await redisSub.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  await redisSub.quit();
}

// Session management
export const sessionRedis = {
  async set(sessionId: string, data: unknown, ttlSeconds: number): Promise<void> {
    await redis.setex(`${config.redisSessionPrefix}${sessionId}`, ttlSeconds, JSON.stringify(data));
  },

  async get<T>(sessionId: string): Promise<T | null> {
    const data = await redis.get(`${config.redisSessionPrefix}${sessionId}`);
    return data ? JSON.parse(data) : null;
  },

  async delete(sessionId: string): Promise<void> {
    await redis.del(`${config.redisSessionPrefix}${sessionId}`);
  },

  async exists(sessionId: string): Promise<boolean> {
    return (await redis.exists(`${config.redisSessionPrefix}${sessionId}`)) === 1;
  },

  async updateActivity(sessionId: string, ttlSeconds: number): Promise<void> {
    const data = await this.get(sessionId);
    if (data) {
      data.lastActivityAt = new Date().toISOString();
      await this.set(sessionId, data, ttlSeconds);
    }
  },
};

// Rate limiting
export const rateLimitRedis = {
  async increment(key: string, windowMs: number): Promise<{ count: number; ttl: number }> {
    const redisKey = `${config.redisRateLimitPrefix}${key}`;
    const count = await redis.incr(redisKey);

    if (count === 1) {
      await redis.pexpire(redisKey, windowMs);
    }

    const ttl = await redis.pttl(redisKey);
    return { count, ttl: ttl > 0 ? ttl : windowMs };
  },

  async decrement(key: string): Promise<void> {
    await redis.decr(`${config.redisRateLimitPrefix}${key}`);
  },

  async reset(key: string): Promise<void> {
    await redis.del(`${config.redisRateLimitPrefix}${key}`);
  },

  async getRemaining(key: string, maxRequests: number): Promise<number> {
    const count = await redis.get(`${config.redisRateLimitPrefix}${key}`);
    return Math.max(0, maxRequests - (count ? parseInt(count, 10) : 0));
  },
};

// Cache
export const cacheRedis = {
  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    await redis.setex(`${config.redisCachePrefix}${key}`, ttlSeconds, JSON.stringify(data));
  },

  async get<T>(key: string): Promise<T | null> {
    const data = await redis.get(`${config.redisCachePrefix}${key}`);
    return data ? JSON.parse(data) : null;
  },

  async delete(key: string): Promise<void> {
    await redis.del(`${config.redisCachePrefix}${key}`);
  },

  async deletePattern(pattern: string): Promise<void> {
    const keys = await redis.keys(`${config.redisCachePrefix}${pattern}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  },

  async exists(key: string): Promise<boolean> {
    return (await redis.exists(`${config.redisCachePrefix}${key}`)) === 1;
  },
};

// Pub/Sub for real-time events
export const pubsub = {
  async publish(channel: string, message: unknown): Promise<number> {
    return redis.publish(channel, JSON.stringify(message));
  },

  async subscribe(channel: string, callback: (message: unknown) => void): Promise<void> {
    await redisSub.subscribe(channel);
    redisSub.on('message', (ch, msg) => {
      if (ch === channel) {
        try {
          callback(JSON.parse(msg));
        } catch {
          callback(msg);
        }
      }
    });
  },

  async unsubscribe(channel: string): Promise<void> {
    await redisSub.unsubscribe(channel);
  },
};