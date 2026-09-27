import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { createApp, type AppDeps } from './app.js';
import { attachRealtime, type RealtimeDeps } from './realtime/realtime.js';
import type { RedisClient } from './redis.js';

export interface ServerDeps extends Omit<AppDeps, 'publish'> {
  pool: pg.Pool;
  redis: RedisClient;
  realtime?: Pick<RealtimeDeps, 'socketRateLimit' | 'maxResyncEvents'>;
}

/** HTTP + Socket.IO sobre el mismo puerto. Lo usan index.ts y los tests (que levantan varias instancias). */
export async function startServer(deps: ServerDeps, port: number) {
  const httpServer = createServer();
  const realtime = await attachRealtime(httpServer, {
    pool: deps.pool,
    redis: deps.redis,
    tokenSecret: deps.tokenSecret,
    ...deps.realtime,
  });
  httpServer.on('request', createApp({ ...deps, publish: realtime.publish }));

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  const { port: actualPort } = httpServer.address() as AddressInfo;

  return {
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    realtime,
    /** Cierra sockets y el server HTTP (io.close cierra también el httpServer). */
    close: () => realtime.close(),
  };
}
