import { test, expect } from './fixtures.js';

test('a new install opens on the welcome; a first step opens its page and the welcome is not shown again', async ({ page, app }) => {
  await fetch(`${app.url}/api/welcome`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: false }) });
  await page.goto(app.url);
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Sovran Advisor');
  await expect(page.getByText('Your trusty companion on your Sovran Quest journey.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ana');
  await expect(page.getByRole('region', { name: 'What to call you' }).getByRole('status')).toHaveText('Saved.');
  await page.getByRole('link', { name: /Write your first journal entry/ }).click();
  await expect(page).toHaveURL(/\/journal$/);
  await expect.poll(async () => (await (await fetch(`${app.url}/api/welcome`)).json()).seen).toBe(true);
  await page.goto(app.url);
  await expect(page).not.toHaveURL(/\/welcome$/);
  await page.goto(`${app.url}/welcome`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Ana');
});
