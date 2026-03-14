import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/live': {
        target: process.env.VITE_CLOUD_RUN_URL ?? 'http://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
      '/health': {
        target: process.env.VITE_CLOUD_RUN_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
