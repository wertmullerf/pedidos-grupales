import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type pg from 'pg';
import { config } from '../config.js';
import { createPool } from './pool.js';

// Resuelve igual desde src/db (tsx) y desde dist/db (build).
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

// Clave arbitraria del advisory lock: evita que dos instancias migren a la vez.
const LOCK_KEY = 727_001;

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falló la migración ${file}`, { cause: err });
      }
      ran.push(file);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const pool = createPool(config.DATABASE_URL);
  migrate(pool)
    .then((ran) =>
      console.log(
        ran.length ? `Migraciones aplicadas: ${ran.join(', ')}` : 'Sin migraciones pendientes',
      ),
    )
    .finally(() => pool.end());
}
