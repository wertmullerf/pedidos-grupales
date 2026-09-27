import express from 'express';
import type pg from 'pg';
import { apiRouter, DEFAULT_RATE_LIMITS, type ApiDeps } from './http/api.js';
import { errorHandler } from './http/errors.js';
import type { RedisClient } from './redis.js';

export interface AppDeps {
  pool: pg.Pool;
  redis: RedisClient;
  instanceId: string;
  tokenSecret: string;
  rateLimits?: ApiDeps['rateLimits'];
  /** Valor de `trust proxy` de Express, para que req.ip sea la IP real detrás de nginx. */
  trustProxy?: string;
}

export function createApp({
  pool,
  redis,
  instanceId,
  tokenSecret,
  rateLimits = DEFAULT_RATE_LIMITS,
  trustProxy = 'loopback',
}: AppDeps) {
  const app = express();
  // Un número es cantidad de saltos ('1' = solo nginx); otro valor es una lista de IPs/subredes.
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
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

  app.use('/api', apiRouter({ pool, redis, tokenSecret, rateLimits }));
  app.use(errorHandler);

  return app;
}
