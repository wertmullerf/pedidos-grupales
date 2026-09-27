import { z } from 'zod';

const DEV_TOKEN_SECRET = 'dev-only-token-secret-change-me';

const Env = z
  .object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    // Defaults pensados para desarrollo local contra los contenedores de docker compose.
    DATABASE_URL: z.string().url().default('postgres://pedido:pedido@localhost:5433/pedido'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    INSTANCE_ID: z.string().default('local'),
    // Firma los tokens de participante. Todas las instancias deben compartir el mismo valor.
    TOKEN_SECRET: z.string().min(16).default(DEV_TOKEN_SECRET),
    // Proxies confiables para calcular la IP real (rate limit). Detrás de nginx: '1' (un salto).
    TRUST_PROXY: z.string().default('loopback'),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.TOKEN_SECRET !== DEV_TOKEN_SECRET, {
    message: 'TOKEN_SECRET es obligatorio en producción',
    path: ['TOKEN_SECRET'],
  });

export const config = Env.parse(process.env);
