import { defineConfig } from 'vitest/config';

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
