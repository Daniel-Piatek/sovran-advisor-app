// Tell Daniel (module tell, 2026-11-19): from a journal entry and from Help, pick what it is, say why, see what goes with
// it, and send. The app runs here with a stand-in for the Sovran cloud (tests/fake-group-cloud.js).

import { test, expect } from '@playwright/test';
import { startServer } from '../../server.js';
import { useGroup } from '../../group-feed.js';
import { libraryKey } from '../../sovran-library.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';

async function start(testInfo) {
  const cloud = fakeGroupCloud({ students: { [KEY]: { id: 'client-aaaaaaaaaaaa', name: 'Maya' } } });
  const app = await startServer({ dataDir: testInfo.outputPath('data'), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0 });
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed', keyOf: libraryKey, guideApp: false });
  await fetch(`${app.url}/api/library`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY }) });
  return { app, cloud };
}

test('Tell Daniel from a journal entry: what goes with it is shown, then sent', async ({ page }, testInfo) => {
  const { app, cloud } = await start(testInfo);
  try {
    const made = await (await fetch(`${app.url}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: '2026-11-17', title: 'By the lake', body: 'The Tyrant was loud today.' }) })).json();
    await page.goto(`${app.url}/journal/entries/${made.id}`);
    await page.getByRole('button', { name: 'Tell Daniel' }).click();
    const box = page.getByRole('dialog', { name: 'Tell Daniel' });
    await expect(box.getByRole('button', { name: 'Send to Daniel' })).toBeDisabled();
    await box.getByLabel(/I have a question about this/).check();
    await box.getByLabel('Tell Daniel why').fill('Is the Tyrant always this loud in week 2?');
    await expect(box.locator('.tell-preview')).toContainText('The Tyrant was loud today.');
    await expect(box.locator('.tell-preview')).toContainText(/\d+\.\d+\.\d+/); // the app's version
    await box.getByRole('button', { name: 'Send to Daniel' }).click();
    await expect(box.getByRole('heading', { name: 'Sent to Daniel' })).toBeVisible();
    const sent = cloud.state.tells[0];
    expect(sent).toMatchObject({ kind: 'question', place: 'journal', why: 'Is the Tyrant always this loud in week 2?', context: { title: 'By the lake', words: 'The Tyrant was loud today.' } });
    expect(sent.app_version).toMatch(/^\d+\.\d+\.\d+/);
  } finally { await app.close(); }
});

test('Tell Daniel from Help: Other needs words', async ({ page }, testInfo) => {
  const { app, cloud } = await start(testInfo);
  try {
    await page.goto(`${app.url}/help`);
    await page.getByRole('button', { name: 'Tell Daniel about a problem or a question' }).click();
    const box = page.getByRole('dialog', { name: 'Tell Daniel' });
    await box.getByLabel(/^Other/).check();
    await box.getByRole('button', { name: 'Send to Daniel' }).click();
    await expect(box.getByRole('status')).toHaveText('Say what it’s about first.');
    await box.getByLabel('Tell Daniel why').fill('The Planner page is blank on my PC.');
    await box.getByRole('button', { name: 'Send to Daniel' }).click();
    await expect(box.getByRole('heading', { name: 'Sent to Daniel' })).toBeVisible();
    expect(cloud.state.tells[0]).toMatchObject({ kind: 'other', place: 'app' });
  } finally { await app.close(); }
});
