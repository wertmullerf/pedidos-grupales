import { createClient } from 'redis';

function buildClient(url: string) {
  const client = createClient({ url });
  client.on('error', (err: Error) => console.error('[redis]', err.message));
  return client;
}

export type RedisClient = ReturnType<typeof buildClient>;

export async function connectRedis(url: string): Promise<RedisClient> {
  const client = buildClient(url);
  await client.connect();
  return client;
}
