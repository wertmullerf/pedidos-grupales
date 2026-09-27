import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // Defaults pensados para desarrollo local contra los contenedores de docker compose.
  DATABASE_URL: z.string().url().default('postgres://pedido:pedido@localhost:5433/pedido'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  INSTANCE_ID: z.string().default('local'),
});

export const config = Env.parse(process.env);
