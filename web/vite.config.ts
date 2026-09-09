import { defineConfig } from 'vite';

// The studio frontend. In development it runs here and talks to studiod across origins; the API base is read
// from VITE_STUDIO_API (defaults to the studiod dev port). `vite build` emits to dist/, which studiod can
// serve from one origin in production (studiod -web ../web/dist).
export default defineConfig({
  server: { port: 5190 },
  build: { outDir: 'dist' },
});
