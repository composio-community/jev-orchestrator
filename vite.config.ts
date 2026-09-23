import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The UI lives in web/. `npm run build` writes web/dist, which src/server.js serves.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'web/src') } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/events': 'http://127.0.0.1:4180', '/snapshot': 'http://127.0.0.1:4180', '/knowledge': 'http://127.0.0.1:4180', '/inbox': 'http://127.0.0.1:4180', '/simulate': 'http://127.0.0.1:4180', '/mode': 'http://127.0.0.1:4180', '/refresh': 'http://127.0.0.1:4180', '/trigger': 'http://127.0.0.1:4180', '/floor': 'http://127.0.0.1:4180' } },
});
