import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const securityHeaders = {
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    headers: securityHeaders,
    proxy: {
      // Proxy API requests to backend
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    headers: securityHeaders,
  },
  resolve: {
    alias: {
      // Polyfill Node.js built-in modules for browser
      events: 'events',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      // Node.js global to browser globalThis
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
