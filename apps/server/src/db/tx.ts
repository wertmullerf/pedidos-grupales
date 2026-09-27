import type pg from 'pg';

/** Resultado que pide deshacer la transacción sin tratarlo como error (p. ej. operación duplicada). */
export class Rollback<T> {
  constructor(readonly value: T) {}
}

export async function withTransaction<T, R = never>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T | Rollback<R>>,
): Promise<T | R> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    if (result instanceof Rollback) {
      await client.query('ROLLBACK');
      return result.value;
    }
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}
