import { test, expect } from './fixtures.js';

test('the Library shows every token with its value, the components, and follows Light/Dark', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  for (const name of ['Surfaces', 'Text', 'Lines', 'Accent', 'Data colours', 'Type scale', 'Spacing', 'Radius',
    'Button', 'Text field', 'List row', 'Card', 'Chip', 'Checkbox', 'Dialog', 'Sidebar item', 'Segmented switch', 'Approval card', 'Chat bubble', 'Question chip', 'Citation', 'Google account row', 'Empty state']) {
    await expect(page.getByRole('heading', { name, level: 2, exact: true })).toBeVisible();
  }
  const bg = page.locator('.lib-swatch', { hasText: '--color-bg' }).locator('.lib-value');
  await expect(bg).toHaveText('#fbfbfb');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(bg).toHaveText('#1f1d1d');
});

test('the Library is the last part of Settings, not in the sidebar: it opens on a click and shows the same page', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  await expect(page.locator('[data-section="Library"]')).toHaveCount(0);
  const part = page.getByRole('region', { name: 'Library', exact: true });
  await expect(page.locator('section.settings-part:not(section.settings-part section)').last()).toHaveAttribute('aria-label', 'Library');
  const toggle = part.getByRole('button', { name: 'Library' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false'); // folded, even when the others are open
  await expect(part.locator('.lib-swatch')).toHaveCount(0); // drawn only when opened
  await toggle.click();
  await expect(part.getByRole('heading', { name: 'Type scale', level: 2 })).toBeVisible();
  const bg = part.locator('.lib-swatch', { hasText: '--color-bg' }).locator('.lib-value');
  await expect(bg).toHaveText('#fbfbfb');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(bg).toHaveText('#1f1d1d');
  await toggle.click();
  await expect(part.locator('.lib-swatch')).toHaveCount(0);
});
