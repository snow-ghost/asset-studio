import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright covers what godog cannot: whether the browser actually renders the studio. The scenario titles
 * mirror features/e2e/studio-ui.feature and each test carries the same @req-000-* token in its title, so
 * `make trace` can tie the browser coverage back to the specification (AGENTS.md, section 7).
 *
 * The suite serves the BUILT app from studiod on its own port with a fresh, empty data directory each run —
 * the production shape (one origin, CORS off), which is also what REQ-000-13 is about. It is not part of
 * `make bdd` precisely because it needs a browser: the fast acceptance suite must stay runnable in
 * milliseconds without one.
 */
const PORT = 8199;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // Generous: a cold software-rendered WebGL context is slow on a first run, and a flaky timeout would teach
  // the team to ignore this suite.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Serial on purpose: the scenarios share one studio and one data directory.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // WebGL in headless Chromium needs software rendering; without these flags the renderer fails to
    // initialise and every test fails for a reason that has nothing to do with the studio.
    launchOptions: {
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The full Chromium build, not the headless shell: the shell has no WebGL implementation.
        channel: 'chromium',
      },
    },
  ],
  webServer: {
    // Build first so dist/ matches the sources under test, then serve it from studiod exactly as production
    // does. The data directory is recreated so every run starts from an empty studio.
    command: [
      'npm run build',
      'rm -rf .e2e-data && mkdir -p .e2e-data',
      `cd ../server && go run ./cmd/studiod -addr :${PORT} -data ../web/.e2e-data -web ../web/dist -cors ''`,
    ].join(' && '),
    url: `${BASE_URL}/api/healthz`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
