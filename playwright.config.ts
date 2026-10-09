import { defineConfig } from '@playwright/test';

const PUERTO = Number(process.env.PUERTO_E2E ?? 3100);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 6 * 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    viewport: { width: 1280, height: 860 },
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    permissions: ['microphone'],
  },
  webServer: {
    command: `npx vite build && PORT=${PUERTO} DUBGAME_DATOS=test-results/datos npx tsx server/index.ts`,
    url: `http://localhost:${PUERTO}/api/info`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
