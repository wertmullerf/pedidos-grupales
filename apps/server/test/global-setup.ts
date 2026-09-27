import pg from 'pg';
import { config } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';

/** Crea la base de tests si no existe (conectándose a la base de mantenimiento "postgres"). */
async function ensureDatabase(url: string) {
  const target = new URL(url);
  const name = target.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!rowCount) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}

// Deja la base de tests migrada y con el seed antes de cualquier test.
export default async function setup() {
  await ensureDatabase(config.DATABASE_URL);
  const pool = createPool(config.DATABASE_URL);
  try {
    await migrate(pool);
    await seed(pool);
  } finally {
    await pool.end();
  }
}
