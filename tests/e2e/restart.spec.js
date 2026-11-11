// Settings > Restart: the app stops and starts again by itself, and the page comes back (no Terminal).
import { test, expect } from './fixtures.js';

test.use({ expectedConsoleErrors: [/Failed to load resource|ERR_CONNECTION|Failed to fetch/] }); // the app is away for a moment

test('Settings > Restart: the app restarts itself with the same data, and the page comes back', async ({ page, app }) => {
  await fetch(`${app.url}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Kept through a restart' }) });
  await page.goto(`${app.url}/settings`);
  const part = page.getByRole('region', { name: 'Restart' });
  await expect(part).toBeVisible();
  await part.getByRole('button', { name: 'Restart the app' }).click();
  await expect(part.getByRole('status')).toHaveText('Restarting…');
  // The page reloads itself once the app answers again: the status is empty and the button usable.
  await expect(part.getByRole('status')).toHaveText('', { timeout: 30_000 });
  await expect(part.getByRole('button', { name: 'Restart the app' })).toBeEnabled();
  const notes = await fetch(`${app.url}/api/notes`).then((r) => r.json());
  expect(notes.map((n) => n.title)).toContain('Kept through a restart');
  await fetch(`${app.url}/api/quit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); // the new one stands on its own: stop it
});
