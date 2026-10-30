import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'site',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 800,
    modulePreload: { polyfill: false },
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), dashboard: resolve(__dirname, 'dashboard.html') } },
  },
});
