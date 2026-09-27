import { afterAll, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { connectRedis, type RedisClient } from '../src/redis.js';

export const TEST_TOKEN_SECRET = 'test-token-secret-1234';

/** App real contra Postgres/Redis de docker; registra los hooks de apertura y cierre. */
export function useTestApp() {
  const pool = createPool(config.DATABASE_URL);
  const ctx = { pool, app: undefined as unknown as Express };
  let redis: RedisClient;

  beforeAll(async () => {
    redis = await connectRedis(config.REDIS_URL);
    ctx.app = createApp({ pool, redis, instanceId: 'test', tokenSecret: TEST_TOKEN_SECRET });
  });
  afterAll(async () => {
    await Promise.all([pool.end(), redis.quit()]);
  });

  return ctx;
}
