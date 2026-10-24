import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin API in development so cookies and the CSRF Origin check behave as in production.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  test: { environment: 'jsdom' },
});
