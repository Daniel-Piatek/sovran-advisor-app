// The Course link (course.js): hidden until the course page's address is known, then a sidebar link that
// opens that page in a new tab; Settings sets the address; off in Settings › Modules, it goes.
import { test, expect } from './fixtures.js';

const put = (app, url) => fetch(`${app.url}/api/course`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });

test('the Course link shows once there is an address, opens it in a new tab, and goes when the module is off', async ({ page, app }) => {
  await page.goto(app.url);
  const link = page.locator('.sidebar-link[data-section="Course"]'); // on a phone it sits under More
  await expect(link).toHaveJSProperty('hidden', true);
  expect((await put(app, 'https://example.com/course')).status).toBe(200);
  await page.goto(app.url);
  await expect(link).toHaveJSProperty('hidden', false);
  await expect(link).toHaveAttribute('href', 'https://example.com/course');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener');
  await fetch(`${app.url}/api/modules`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'course', on: false }) });
  await page.goto(app.url);
  await expect(link).toHaveJSProperty('hidden', true);
});

test.describe('a bad address', () => {
  test.use({ expectedConsoleErrors: [/400/] });
  test('Settings sets the address, refuses one that is not a web address, and clearing it removes the link', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  const part = page.getByRole('region', { name: 'Course' });
  await part.getByLabel('Course page address').fill('not an address');
  await part.getByRole('button', { name: 'Save' }).click();
  await expect(part.getByRole('status')).toContainText('https://');
  await part.getByLabel('Course page address').fill('https://example.com/course');
  await part.getByRole('button', { name: 'Save' }).click();
  const link = page.locator('.sidebar-link[data-section="Course"]');
  await expect(link).toHaveJSProperty('hidden', false);
  await part.getByRole('button', { name: 'Use the app’s own' }).click();
  await expect(link).toHaveJSProperty('hidden', true);
});
});

test.describe('addresses that are refused', () => {
  test.use({ expectedConsoleErrors: [] });
  test('only a plain https address is taken', async ({ app }) => {
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com/', 'not an address']) {
      expect((await put(app, bad)).status, bad).toBe(400);
    }
    expect((await put(app, '')).status).toBe(200);
  });
});
