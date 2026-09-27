import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp, type AppDeps } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { connectRedis, type RedisClient } from '../src/redis.js';

export const TEST_TOKEN_SECRET = 'test-token-secret-1234';

/**
 * App real contra Postgres/Redis de docker; registra los hooks de apertura y cierre.
 * Por defecto usa límites altos y un prefijo de Redis propio, para que el rate limit
 * no interfiera entre tests ni entre corridas.
 */
export function useTestApp(overrides: Partial<Pick<AppDeps, 'rateLimits'>> = {}) {
  const pool = createPool(config.DATABASE_URL);
  const ctx = {
    pool,
    app: undefined as unknown as Express,
    redis: undefined as unknown as RedisClient,
  };

  beforeAll(async () => {
    ctx.redis = await connectRedis(config.REDIS_URL);
    ctx.app = createApp({
      pool,
      redis: ctx.redis,
      instanceId: 'test',
      tokenSecret: TEST_TOKEN_SECRET,
      rateLimits: overrides.rateLimits ?? {
        preview: { limit: 10_000, windowSeconds: 60 },
        join: { limit: 10_000, windowSeconds: 60 },
        keyPrefix: `test-rl:${randomUUID()}`,
      },
    });
  });
  afterAll(async () => {
    await Promise.all([pool.end(), ctx.redis.quit()]);
  });

  return ctx;
}
