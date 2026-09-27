import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { connectRedis, type RedisClient } from '../src/redis.js';

describe('GET /health', () => {
  const pool = createPool(config.DATABASE_URL);
  let redis: RedisClient;

  beforeAll(async () => {
    redis = await connectRedis(config.REDIS_URL);
  });
  afterAll(async () => {
    await Promise.all([pool.end(), redis.quit()]);
  });

  it('responde ok cuando Postgres y Redis están disponibles', async () => {
    const res = await request(createApp({ pool, redis, instanceId: 'test' })).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', instance: 'test', db: 'ok', redis: 'ok' });
  });
});
