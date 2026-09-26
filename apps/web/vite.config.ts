import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in development: /api/* goes to the API, /files/* serves screenshots.
    proxy: {
      '/api': { target: API, rewrite: (path) => path.replace(/^\/api/, '') },
      '/files': API,
    },
  },
});
