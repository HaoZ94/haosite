import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    // Keep generated bundles separate from the original public asset URLs.
    assetsDir: '_app',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
