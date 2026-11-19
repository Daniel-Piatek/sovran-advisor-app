// Group Circle (module group, 2026-11-19): pick a name, read Announcements and tick homework, post in the Circle with a
// picture made smaller here, like and comment, and Share to Group Circle from a journal entry. The app runs here with a
// stand-in for the Sovran cloud (tests/fake-group-cloud.js); the cloud's own rules are checked in cloud/group-feed.test.sql.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../server.js';
import { useGroup } from '../../group-feed.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const KEY = 'sovran_madeupmadeupmadeupmadeup';
const PICTURE = fileURLToPath(new URL('../../public/brand/sovran-pattern-report.png', import.meta.url));
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

async function start(testInfo, { name = null } = {}) {
  const cloud = fakeGroupCloud({
    students: { [KEY]: { id: 'client-aaaaaaaaaaaa', name }, sovran_jonjonjonjonjonjonjonjon: { id: 'client-bbbbbbbbbbbb', name: 'Jon' } },
    posts: [
      { id: 1, tab: 'news', kind: 'homework', body: 'Week 2: meet your Tyrant. Write one page in your Journal.', due_on: '2026-11-22', created_at: ago(90) },
      { id: 2, tab: 'feed', kind: 'post', student: 'client-bbbbbbbbbbbb', body: 'Took my Tyrant for a walk up the ridge.', created_at: ago(30) },
    ],
  });
  const app = await startServer({ dataDir: testInfo.outputPath('data'), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0 });
  useGroup({ fetch: cloud.fetcher, url: 'https://cloud.test/group-feed' });
  await fetch(`${app.url}/api/library`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: KEY }) });
  await fetch(`${app.url}/api/welcome`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  return { app, cloud };
}

test('a first visit: pick a name, then Announcements with homework to tick', async ({ page }, testInfo) => {
  const { app, cloud } = await start(testInfo);
  try {
    await page.goto(`${app.url}/group`);
    await expect(page.getByRole('heading', { name: 'Welcome to Sovran Quest' })).toBeVisible();
    await page.getByLabel('Your name in the group').fill('Maya');
    await page.getByRole('button', { name: 'Continue' }).click();
    // Something new waits in Announcements, so it opens there.
    await expect(page).toHaveURL(/\/group\/announcements$/);
    await expect(page.locator('.group-kind-homework')).toHaveText('Homework');
    await expect(page.getByText('Only Daniel posts here')).toBeVisible();
    await expect(page.locator('.group-composer')).toHaveCount(0); // no writing box: Announcements are Daniel's
    await page.getByLabel('Mark as done').check();
    await expect.poll(() => cloud.state.posts.find((p) => p.id === 1).done).toEqual(['client-aaaaaaaaaaaa']);
    await page.getByLabel('Ask a question').fill('Can I write two pages?');
    await page.getByLabel('Ask a question').press('Enter');
    await expect(page.locator('.group-bubble')).toContainText('Can I write two pages?');
  } finally { await app.close(); }
});

test('the Circle: a post with a picture made smaller here, a like and a comment', async ({ page }, testInfo) => {
  const { app, cloud } = await start(testInfo, { name: 'Maya' });
  try {
    await page.goto(`${app.url}/group/circle`);
    await expect(page.getByText('Only SQ01 sees these posts')).toBeVisible();
    await page.getByLabel('Write a post').fill('Sat by the lake before work.');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Add image' }).click();
    await (await chooser).setFiles(PICTURE);
    await expect(page.locator('.group-composer .group-status')).toContainText('Made smaller on this computer');
    await expect(page.locator('.group-thumb img')).toHaveCount(1);
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    const mine = page.locator('.group-post').first();
    await expect(mine).toContainText('Sat by the lake before work.');
    await expect(mine.locator('.group-pictures img')).toBeVisible();
    // What reached the cloud: a JPEG, much smaller than the photo chosen.
    const sent = [...cloud.state.pictures.values()][0];
    expect(sent.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(sent.length).toBeLessThan(300_000);
    // Jon's post: like it and comment.
    const jons = page.locator('.group-post', { hasText: 'Took my Tyrant' });
    await jons.locator('.group-like').click();
    await expect(jons.locator('.group-like')).toHaveAttribute('aria-pressed', 'true');
    await jons.getByLabel('Write a comment').fill('Love this');
    await jons.getByLabel('Write a comment').press('Enter');
    await expect(page.locator('.group-post', { hasText: 'Took my Tyrant' }).locator('.group-bubble')).toContainText('Love this');
    // My own post's ••• has Edit and Delete; Jon's has Let Daniel know.
    await jons.getByRole('button', { name: 'More' }).first().click();
    await expect(page.getByRole('menuitem', { name: 'Let Daniel know about this post' })).toBeVisible();
  } finally { await app.close(); }
});

test('Share to Group Circle from a journal entry fills the Circle’s box, to check before posting', async ({ page }, testInfo) => {
  const { app, cloud } = await start(testInfo, { name: 'Maya' });
  try {
    const made = await (await fetch(`${app.url}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: '2026-11-17', title: 'By the lake', body: 'Today I let the Tyrant talk and watched the water.' }) })).json();
    await page.goto(`${app.url}/journal/entries/${made.id}`);
    await page.getByRole('button', { name: 'Share to Group Circle' }).click();
    await expect(page).toHaveURL(/\/group\/circle$/);
    await expect(page.locator('.group-from')).toContainText('This came from your Journal');
    await expect(page.getByLabel('Write a post')).toHaveValue('By the lake\n\nToday I let the Tyrant talk and watched the water.');
    expect(cloud.state.asked.some((m) => m.action === 'post')).toBe(false); // nothing posted yet
  } finally { await app.close(); }
});
