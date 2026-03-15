import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load .env files so the proxy target is picked up correctly.
  // process.env doesn't include Vite .env variables by default in the config.
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_CLOUD_RUN_URL ?? 'http://localhost:8082';

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/live': {
          target: backendUrl,
          ws: true,
          changeOrigin: true,
        },
        '/health': {
          target: backendUrl,
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
  };
});
