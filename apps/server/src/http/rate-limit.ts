import type { RequestHandler } from 'express';
import type { RedisClient } from '../redis.js';
import { AppError } from './errors.js';

export interface RateLimitRule {
  /** Requests permitidos por ventana. */
  limit: number;
  windowSeconds: number;
}

/**
 * Rate limit por IP con ventana fija, guardado en Redis para que el conteo se comparta entre
 * instancias (con nginx round-robin, cada request puede caer en un server distinto).
 * Si Redis no responde, deja pasar: preferimos disponibilidad a bloquear a todos.
 */
export function rateLimit(
  redis: RedisClient,
  name: string,
  { limit, windowSeconds }: RateLimitRule,
  keyPrefix = 'rl',
): RequestHandler {
  return async (req, res, next) => {
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `${keyPrefix}:${name}:${req.ip}:${window}`;

    let count: number;
    try {
      // INCR + EXPIRE atómicos: la clave nunca queda sin TTL.
      const [incr] = await redis.multi().incr(key).expire(key, windowSeconds).exec();
      count = Number(incr);
    } catch (err) {
      console.error('[rate-limit] Redis no disponible, se omite el límite', err);
      return next();
    }

    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, limit - count));
    if (count > limit) {
      const retryAfter = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
      res.setHeader('Retry-After', retryAfter);
      throw new AppError(429, 'RATE_LIMITED', 'Demasiados intentos, probá en unos segundos');
    }
    next();
  };
}
