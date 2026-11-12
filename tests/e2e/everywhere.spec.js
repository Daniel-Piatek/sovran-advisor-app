// Phone, backups and moving (myICOR advanced/everywhere 3, 8 and 11, the Sovran Advisor way): off in a new install.
import fs from 'node:fs';
import { test, expect } from './fixtures.js';

const switchOn = async (page, app) => {
  await page.goto(`${app.url}/settings`);
  await expect(page.getByRole('heading', { name: 'Phone, backups and moving' })).toHaveCount(0);
  await page.locator('[data-module="everywhere"]').getByRole('button', { name: 'On' }).click();
  await expect(page.getByRole('heading', { name: 'Phone, backups and moving' })).toBeVisible();
};

test('switch it on: the daily backups show, each checked, and Check them now checks them again', async ({ page, app }) => {
  await switchOn(page, app);
  const part = page.getByRole('region', { name: 'Phone, backups and moving' });
  await expect(part.locator('.backup-row')).toHaveCount(1);
  await expect(part.locator('.backup-row')).toContainText('complete');
  await expect(part.locator('.backup-row')).toContainText('the same as the app');
  await part.getByRole('button', { name: 'Check them now' }).click();
  await expect(part.getByRole('status').filter({ hasText: 'All 1 copy is complete.' })).toBeVisible();
  await expect(part).toContainText('Ask Claude: “set up Sovran Advisor on my phone”');
});

test('make a moving file, bring it in: it shows what it holds and waits for your yes', async ({ page, app }, testInfo) => {
  await app.createNote({ title: 'Packed for the move' });
  await switchOn(page, app);
  const part = page.getByRole('region', { name: 'Phone, backups and moving' });
  const [download] = await Promise.all([page.waitForEvent('download'), part.getByRole('link', { name: 'Make a moving file' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sovran-advisor-move-\d{4}-\d{2}-\d{2}\.tar\.gz$/);
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  expect(fs.statSync(file).size).toBeGreaterThan(1000);
  await part.locator('input[type=file]').setInputFiles(file);
  const waiting = part.getByRole('group', { name: 'The moving file' });
  await expect(waiting).toContainText('It holds 1 note');
  await expect(waiting.getByRole('button', { name: 'Replace everything here with it' })).toBeVisible();
  await waiting.getByRole('button', { name: 'Put it away' }).click();
  await expect(part.getByRole('status').filter({ hasText: 'Put away. Nothing was changed.' })).toBeVisible();
  await expect(waiting).toHaveCount(0);
});

test.describe('away from the computer', () => {
  test.use({ expectedConsoleErrors: [/ERR_FAILED|Failed to load resource/] }); // the computer is away on purpose: the send fails

test('the Capture page keeps a thought in the Inbox, and keeps it on the phone while the computer is away', async ({ page, app }) => {
  await page.goto(`${app.url}/quick`);
  await expect(page.getByRole('heading', { name: 'Capture is switched off' })).toBeVisible();
  await switchOn(page, app);
  await page.goto(`${app.url}/quick`);
  await page.getByRole('textbox', { name: 'Your thought' }).fill('Call the printer about the workbook');
  await page.getByRole('button', { name: 'Keep in Inbox' }).click();
  await expect(page.getByRole('status')).toHaveText('Kept in your Inbox.');
  await page.getByRole('button', { name: 'From someone else' }).click();
  await page.route('**/api/captures', (route) => route.abort());
  await page.getByRole('textbox', { name: 'Your thought' }).fill('A book Anna recommended');
  await page.getByRole('button', { name: 'Keep in Inbox' }).click();
  await expect(page.getByRole('status')).toContainText('Saved on this phone');
  await page.unroute('**/api/captures');
  await page.reload();
  await expect(page.getByRole('status')).toContainText('1 saved earlier is now in your Inbox.');
  const captures = await (await fetch(`${app.url}/api/captures`)).json();
  expect(captures.map((c) => [c.body, c.world]).sort()).toEqual([['A book Anna recommended', 'outer'], ['Call the printer about the workbook', 'inner']]);
});
});
