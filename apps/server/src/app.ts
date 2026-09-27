import express from 'express';
import type pg from 'pg';
import { apiRouter } from './http/api.js';
import { errorHandler } from './http/errors.js';
import type { RedisClient } from './redis.js';

export interface AppDeps {
  pool: pg.Pool;
  redis: RedisClient;
  instanceId: string;
  tokenSecret: string;
}

export function createApp({ pool, redis, instanceId, tokenSecret }: AppDeps) {
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    const [db, cache] = await Promise.allSettled([pool.query('SELECT 1'), redis.ping()]);
    const ok = db.status === 'fulfilled' && cache.status === 'fulfilled';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      instance: instanceId,
      db: db.status === 'fulfilled' ? 'ok' : 'down',
      redis: cache.status === 'fulfilled' ? 'ok' : 'down',
    });
  });

  app.use('/api', apiRouter(pool, tokenSecret));
  app.use(errorHandler);

  return app;
}
