// Replies on Tell Daniel (2026-11-24): Daniel's reply shows on What you told Daniel (from Help, or the alert), and the
// student answers him there. The app runs here with a stand-in for the Sovran cloud (tests/fake-group-cloud.js).

import { test, expect } from '@playwright/test';
import { startServer } from '../../server.js';
import { useGroup } from '../../group-feed.js';
import { libraryKey } from '../../sovran-library.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';

test('What you told Daniel: his reply, read and answered', async ({ page }, testInfo) => {
  const cloud = fakeGroupCloud({ students: { [KEY]: { id: 'client-aaaaaaaaaaaa', name: 'Maya' } } });
  const app = await startServer({ dataDir: testInfo.outputPath('data'), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0 });
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed', keyOf: libraryKey, guideApp: false });
  await fetch(`${app.url}/api/library`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY }) });
  try {
    await page.goto(`${app.url}/help`);
    await page.getByRole('button', { name: 'Tell Daniel about a problem or a question' }).click();
    const box = page.getByRole('dialog', { name: 'Tell Daniel' });
    await box.getByLabel(/Something isn/).check();
    await box.getByLabel('Tell Daniel why').fill('Tell Daniel didn’t work for me this morning.');
    await box.getByRole('button', { name: 'Send to Daniel' }).click();
    await expect(box.getByText(/His reply comes as an alert, and in Help › What you told Daniel/)).toBeVisible();
    await box.getByRole('button', { name: 'Done' }).click();
    const report = cloud.state.tells[0];
    report.messages.push({ id: 900, from_daniel: true, body: 'Thanks for telling me. Your key is in now: please try once more.', created_at: new Date().toISOString(), read_at: null });

    await page.getByRole('link', { name: 'What you told Daniel' }).click();
    await expect(page).toHaveURL(/\/told-daniel$/);
    const card = page.locator(`[data-report="${report.id}"]`);
    await expect(card).toContainText('Tell Daniel didn’t work for me this morning.');
    await expect(card).toContainText('Your key is in now');
    await expect(card.getByText('New reply')).toBeVisible();
    await expect.poll(() => report.messages[0].read_at).toBeTruthy();
    await card.getByLabel(/Your answer to Daniel/).fill('It worked, thank you!');
    await card.getByRole('button', { name: 'Send to Daniel' }).click();
    await expect(card.locator('.tell-message')).toHaveCount(2);
    expect(report.messages[1]).toMatchObject({ from_daniel: false, body: 'It worked, thank you!' });

    await page.goto(`${app.url}/told-daniel#report-${report.id}`);
    await expect(page.locator(`[data-report="${report.id}"] .tell-reply-box`)).toBeFocused();
  } finally { await app.close(); }
});
