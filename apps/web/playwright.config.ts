import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E smoke suite (GAP-07). Starts a local SMTP sink, the API, the worker and Vite against
 * the disposable *_test database; global setup truncates it and creates fixed fixtures.
 * Local (macOS): `docker compose up -d postgres`, create pm_test and apply migrations
 * (`DATABASE_URL=…/pm_test npx prisma migrate deploy`), `npx playwright install chromium` once,
 * then `E2E_DATABASE_URL=postgresql://pm:pm_local_only@localhost:5432/pm_test npm run e2e`.
 * Ports 2526/8026 (mail sink), 4100 (API) and 5174 (web) must be free.
 */
const DB = process.env.E2E_DATABASE_URL ?? 'postgresql://pm:pm_local_only@localhost:5432/pm_test';
const WEB = 'http://localhost:5174';
const serverEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  DATABASE_URL: DB,
  PORT: '4100',
  WEB_ORIGINS: WEB,
  APP_BASE_URL: WEB,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '2526',
  MAIL_FROM: 'PM E2E <e2e@pm.local>',
  WORKER_POLL_MS: '200',
  // Attachments are not part of the smoke journeys; storage is never contacted.
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_BUCKET: 'e2e-unused',
  S3_ACCESS_KEY_ID: 'e2e',
  S3_SECRET_ACCESS_KEY: 'e2e',
  S3_FORCE_PATH_STYLE: 'true',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: WEB, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'node e2e/mail-sink.mjs',
      url: 'http://127.0.0.1:8026/messages',
      reuseExistingServer: false,
    },
    {
      command: 'npx tsx ../api/src/server.ts',
      url: 'http://localhost:4100/api/v1/health',
      env: serverEnv,
      reuseExistingServer: false,
    },
    {
      command: 'npx tsx ../worker/src/main.ts',
      env: { ...serverEnv, LOG_LEVEL: 'info' },
      wait: { stdout: /worker started/ },
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      url: WEB,
      env: { API_PROXY_TARGET: 'http://localhost:4100' },
      reuseExistingServer: false,
    },
  ],
});
