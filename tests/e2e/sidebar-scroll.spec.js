// The sidebar on a short window (2026-11-23): taller than the window, its sections scroll on their own,
// Sovran Central's name stays at the top, and the last section can be reached.
import { test, expect } from './fixtures.js';

test('the sidebar scrolls on a short window and keeps the name at the top', async ({ page, app }, testInfo) => {
  test.skip(testInfo.project.name === 'phone', 'on a phone the sidebar is the bar along the bottom');
  await page.setViewportSize({ width: 1280, height: 560 });
  await page.goto(app.url);
  const sidebar = page.locator('#sidebar');
  const brand = sidebar.locator('.sidebar-brand');
  await expect(brand).toBeVisible();
  const sizes = await sidebar.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  const before = await brand.boundingBox();
  await sidebar.hover();
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => sidebar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const after = await brand.boundingBox();
  expect(Math.round(after.y)).toBe(Math.round(before.y));
  // The last thing in the sidebar is in the window once scrolled to the end.
  const last = sidebar.locator(':scope > *:not([hidden])').last();
  const box = await last.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(560);
});
