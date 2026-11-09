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
