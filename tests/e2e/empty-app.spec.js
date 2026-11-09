import fs from 'node:fs';
import { test, expect } from './fixtures.js';

test('opens the empty app', async ({ page, app }) => {
  await page.goto(app.url);

  await expect(page).toHaveTitle('Notes');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notes');
  await expect(page.getByText('No notes yet.')).toBeVisible();

  // Nothing spills sideways on a small screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // This copy of the app made its own database, in its own folder.
  const health = await page.request.get(`${app.url}/api/health`);
  expect(await health.json()).toEqual({ ok: true });
  expect(fs.existsSync(app.dbFile)).toBe(true);
});
