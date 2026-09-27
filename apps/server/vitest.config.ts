import { defineConfig } from 'vitest/config';

// Los tests usan su propia base (pedido_test) en el Postgres de docker, para no ensuciar la de
// desarrollo/demo. global-setup la crea si no existe.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://pedido:pedido@localhost:5433/pedido_test';

export default defineConfig({
  // Los paquetes del monorepo se importan desde sus fuentes TS (condición de export "source").
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Los tests de integración comparten una base real: correrlos en serie evita interferencias.
    fileParallelism: false,
  },
});
