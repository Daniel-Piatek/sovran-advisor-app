// The update nudge (public/update-nudge.js): when a new version is ready, "Update" beside Settings and a notice once.
// The server's answer is stood in for, so no test copy ever really updates.
import { test, expect } from './fixtures.js';

const READY = { can: true, check: { checked_at: '2026-11-15T08:00:00.000Z', behind: 2, news: ['Dictation on a Windows PC', 'Phone notes tidied'], db_upgrade: false }, last: null, undo: null, progress: null, update_line: 'Update Sovran Central by following …' };
const NEWEST = { ...READY, check: { ...READY.check, behind: 0, news: [] } };

test('a new version: Update beside Settings and the notice; Later hides the notice for that version, the mark stays', async ({ page, app }) => {
  await page.route('**/api/update', (route) => route.fulfill({ json: READY }));
  await page.goto(`${app.url}/journal`);
  const notice = page.getByRole('status').filter({ hasText: 'A new version of Sovran Central is ready.' });
  await expect(notice).toBeVisible();
  const settings = page.locator('.sidebar-link[data-section="Settings"]');
  if (test.info().project.name !== 'phone') await expect(settings.getByText('Update', { exact: true })).toBeVisible();
  await notice.getByRole('button', { name: 'Later' }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.sidebar-update')).toHaveCount(1);
  await page.waitForTimeout(2000);
  await expect(page.getByText('A new version of Sovran Central is ready.')).toHaveCount(0);
});

test('Update now starts the update and opens Settings to follow it', async ({ page, app }) => {
  let started = false;
  await page.route('**/api/update', (route) => {
    if (route.request().method() === 'POST') { started = true; return route.fulfill({ json: { started: true } }); }
    return route.fulfill({ json: READY });
  });
  await page.goto(`${app.url}/journal`);
  await page.getByRole('button', { name: 'Update now' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  expect(started).toBe(true);
  await expect(page.getByText('A new version of Sovran Central is ready.')).toHaveCount(0);
});

test('the newest version already: no mark and no notice', async ({ page, app }) => {
  await page.route('**/api/update', (route) => route.fulfill({ json: NEWEST }));
  await page.goto(`${app.url}/journal`);
  await page.waitForTimeout(2200);
  await expect(page.locator('.sidebar-update')).toBeHidden();
  await expect(page.getByText('A new version of Sovran Central is ready.')).toHaveCount(0);
});
