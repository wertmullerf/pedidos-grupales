import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo el front habla con nginx (las dos instancias del server) salvo que se indique otro.
const backend = process.env.VITE_BACKEND ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Los paquetes del monorepo se consumen desde sus fuentes TS.
    conditions: ['source', 'module', 'browser', 'development|production'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/health': backend,
      '/socket.io': { target: backend, ws: true },
    },
  },
});
