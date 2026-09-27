import { config } from './config.js';
import { createPool } from './db/pool.js';
import { connectRedis } from './redis.js';
import { startServer } from './server.js';

const pool = createPool(config.DATABASE_URL);
const redis = await connectRedis(config.REDIS_URL);
const server = await startServer(
  {
    pool,
    redis,
    instanceId: config.INSTANCE_ID,
    tokenSecret: config.TOKEN_SECRET,
    trustProxy: config.TRUST_PROXY,
  },
  config.PORT,
);
console.log(`[${config.INSTANCE_ID}] escuchando en :${server.port}`);

async function shutdown() {
  await server.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
