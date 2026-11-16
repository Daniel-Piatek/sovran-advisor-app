// Settings, folded (public/settings-sections.js): each part shows only its name with an arrow and, where the name doesn't
// say it, a short line; a click opens it and that is remembered. Updates shows a turning mark and a line while it works.
import { test, expect } from './fixtures.js';

test.use({ settingsFolded: true });

test('every part opens on a click of its name; a short line says what is inside; open is remembered', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  const modules = page.getByRole('region', { name: 'Modules' });
  const toggle = modules.getByRole('button', { name: 'Modules' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(modules.getByText('Switch parts of the app on or off.')).toBeVisible();
  await expect(modules.locator('[data-module="people-plus"]')).toBeHidden();
  await expect(page.getByRole('region', { name: 'Updates' }).getByRole('button', { name: 'Updates' })).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(modules.locator('[data-module="people-plus"]')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Modules' }).locator('[data-module="people-plus"]')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Activity' }).getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('region', { name: 'Modules' }).getByRole('button', { name: 'Modules' }).click();
  await expect(page.getByRole('region', { name: 'Modules' }).locator('[data-module="people-plus"]')).toBeHidden();
});

test('while an update runs, its part is open, the step under way turns, and a line says it is working', async ({ page, app }) => {
  const steps = [
    { id: 'copy', label: 'A whole copy of your notes and settings', state: 'done' },
    { id: 'new', label: 'The new version', state: 'doing' },
    { id: 'restart', label: 'Starting it again', state: 'waiting' },
  ];
  await page.route('**/api/update', (route) => route.fulfill({ json: {
    can: true, check: null, last: null, update_line: 'Update Sovran Advisor by following INSTALL.md', progress: { running: true, steps, result: null },
  } }));
  await page.goto(`${app.url}/settings`);
  const part = page.getByRole('region', { name: 'Updates' });
  await expect(part.getByRole('button', { name: 'Updates' })).toHaveAttribute('aria-expanded', 'true');
  await expect(part.locator('li[data-state="doing"] .update-turning')).toBeVisible();
  await expect(part.locator('li[data-state="doing"]')).toContainText('The new version…');
  await expect(part.getByText('Updating. This can take a few minutes.')).toBeVisible();
});

test.describe(() => {
  test.use({ expectedConsoleErrors: [/ERR_CONNECTION_REFUSED|Failed to load resource/] });
  test('when the app restarts between two looks, the page says it is starting again instead of standing on a step', async ({ page, app }) => {
  let looks = 0;
  await page.route('**/api/update', (route) => (looks++ === 0
    ? route.fulfill({ json: { can: true, check: null, last: null, update_line: 'x', progress: { running: true, steps: [{ id: 'bring', label: 'The new version', state: 'doing' }], result: null } } })
    : route.abort('connectionrefused')));
  await page.goto(`${app.url}/settings`);
  await expect(page.getByRole('region', { name: 'Updates' }).getByText('Starting again… this page comes back by itself.')).toBeVisible();
});
});
