import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node src/server.js',
    url: 'http://127.0.0.1:4173/healthz',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'test',
      PORT: '4173',
      DATABASE_PATH: './data/e2e.sqlite',
      COOKIE_SECRET: 'e2e-cookie-secret-that-is-at-least-thirty-two-characters',
      COOKIE_SECURE: 'false',
      REPORT_TTL_MS: '300000'
    }
  }
});
