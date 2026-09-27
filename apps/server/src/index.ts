import { createApp } from './app.js';
import { config } from './config.js';
import { createPool } from './db/pool.js';
import { connectRedis } from './redis.js';

const pool = createPool(config.DATABASE_URL);
const redis = await connectRedis(config.REDIS_URL);
const app = createApp({
  pool,
  redis,
  instanceId: config.INSTANCE_ID,
  tokenSecret: config.TOKEN_SECRET,
});

const server = app.listen(config.PORT, () => {
  console.log(`[${config.INSTANCE_ID}] escuchando en :${config.PORT}`);
});

async function shutdown() {
  server.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
