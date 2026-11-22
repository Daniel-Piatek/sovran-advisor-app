// Alerts (2026-11-22): Settings › Alerts has a switch for each kind, and something new in Group Circle shows as an
// alert (here inside the app, as the window is in front) whose Open goes straight to that post. The app runs with a
// stand-in for the Sovran cloud (tests/fake-group-cloud.js); the cloud's own rules are in cloud/group-alerts.test.sql.

import { test, expect } from '@playwright/test';
import { startServer } from '../../server.js';
import { useGroup } from '../../group-feed.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

async function start(testInfo) {
  const cloud = fakeGroupCloud({
    students: { [KEY]: { id: 'client-aaaaaaaaaaaa', name: 'Maya' } },
    posts: [{ id: 1, tab: 'news', kind: 'reminder', body: 'Bring your chart on Thursday.', created_at: ago(90) }],
  });
  const app = await startServer({ dataDir: testInfo.outputPath('data'), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0 });
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed' });
  await fetch(`${app.url}/api/library`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY }) });
  await fetch(`${app.url}/api/welcome`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  return { app, cloud };
}
const askNow = (page) => page.evaluate(() => import('/alerts.js').then((m) => m.askForAlerts()));

test('Settings › Alerts: a switch for each kind, the Circle off at first', async ({ page }, testInfo) => {
  const { app } = await start(testInfo);
  try {
    await page.goto(`${app.url}/settings`);
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    const part = page.getByRole('region', { name: 'Alerts' });
    await expect(part.getByText('A new announcement from Daniel')).toBeVisible();
    const circle = part.getByRole('group', { name: 'Any new post in the Circle' });
    await expect(circle.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    await circle.getByRole('button', { name: 'On' }).click();
    await expect(circle.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
    await part.getByRole('button', { name: 'Show me one' }).click();
    await expect(page.locator('.alert-notice')).toContainText('This is how an alert looks');
  } finally { await app.close(); }
});

test('a new announcement shows as an alert, and Open goes to it', async ({ page }, testInfo) => {
  const { app, cloud } = await start(testInfo);
  try {
    await page.goto(`${app.url}/journal`);
    await askNow(page); // the first ask only sets the moment to ask from
    cloud.state.posts.push({ id: 7, tab: 'news', kind: 'homework', body: 'Week 3: write to your Gremlin.', due_on: null, group: null,
      created_at: new Date(Date.now() + 1000).toISOString(), comments: [], likes: [], done: [], flags: [], pictures: [], comments_on: true });
    await page.waitForTimeout(1100);
    await askNow(page);
    const alert = page.locator('.alert-notice');
    await expect(alert).toContainText('New homework from Daniel');
    await expect(alert).toContainText('Week 3: write to your Gremlin.');
    await alert.getByRole('button', { name: 'Open' }).click();
    await expect(page).toHaveURL(/\/group\/announcements$/);
    await expect(page.locator('[data-post="7"]')).toHaveClass(/group-post-asked/);
  } finally { await app.close(); }
});
