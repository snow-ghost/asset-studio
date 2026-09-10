/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// The studio frontend. In development it runs here and talks to studiod across origins; the API base is read
// from VITE_STUDIO_API (defaults to the studiod dev port). `vite build` emits to dist/, which studiod serves
// from one origin in production (studiod -web ../web/dist) — and then the API base is '' (see
// src/adapters/http/api.ts).
export default defineConfig({
  server: { port: 5190 },
  build: { outDir: 'dist' },
  test: {
    // Vitest owns the unit tests only. Without this, it would also pick up tests/e2e/*.spec.ts, try to run
    // Playwright specs with the wrong runner, and report a failure that has nothing to do with the code — the
    // fastest way to teach a team to ignore a red test suite.
    include: ['tests/unit/**/*.spec.ts'],
    environment: 'node',
    // Fail on an unhandled rejection rather than passing with a warning: a session bug that throws
    // asynchronously must not be reported as success.
    dangerouslyIgnoreUnhandledErrors: false,
  },
});
