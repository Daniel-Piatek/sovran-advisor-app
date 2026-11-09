import { defineConfig, devices } from '@playwright/test';

// Every test starts its own copy of the app (see tests/e2e/fixtures.js),
// so there is no shared webServer here.
// A made-up microphone and no permission box: Dictation tests use no real sound and no real service.
const fakeMic = { permissions: ['microphone', 'clipboard-read', 'clipboard-write'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  projects: [
    // A large screen (the Mac) and a small one (an Android phone).
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...fakeMic } },
    { name: 'phone', use: { ...devices['Pixel 7'], ...fakeMic } },
  ],
});
