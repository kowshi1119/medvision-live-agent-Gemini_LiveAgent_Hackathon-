import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/live':   { target: 'ws://localhost:8081', ws: true, changeOrigin: true },
      '/health': { target: 'http://localhost:8081', changeOrigin: true },
    },
  },
});
