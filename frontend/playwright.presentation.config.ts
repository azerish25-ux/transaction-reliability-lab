import { defineConfig, devices } from '@playwright/test';

// Presentation-only browser tests. API fixtures exercise the shipped React UI;
// they deliberately do not stand in for the real PostgreSQL/RabbitMQ E2E lane.
export default defineConfig({
  testDir: './tests/presentation',
  outputDir: '../.evidence/presentation/results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  reporter: [['list'], ['junit', { outputFile: '../.evidence/presentation/junit.xml' }]],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    locale: 'en-CA', timezoneId: 'UTC', contextOptions: { reducedMotion: 'reduce' },
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : undefined
  },
  webServer: { command: 'npm run dev -- --port 4175', url: 'http://127.0.0.1:4175', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true } }
  ]
});
