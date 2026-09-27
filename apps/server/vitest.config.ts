import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Los tests de integración comparten una base real: correrlos en serie evita interferencias.
    fileParallelism: false,
  },
});
