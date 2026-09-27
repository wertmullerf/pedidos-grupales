import { config } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';

// Deja la base de docker migrada y con el seed antes de cualquier test.
export default async function setup() {
  const pool = createPool(config.DATABASE_URL);
  try {
    await migrate(pool);
    await seed(pool);
  } finally {
    await pool.end();
  }
}
