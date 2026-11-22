// Group Circle, the guide's side (APP Daniel runs the same page with the guide key): make the guide key and see its
// fingerprint, post homework to all groups, see how many ticked it, hide and pause from a post, deal with a flag,
// and manage people. The app runs here with a stand-in for the Sovran cloud (tests/fake-group-cloud.js).

import { test, expect } from '@playwright/test';
import { startServer } from '../../server.js';
import { useGroup, guideKey } from '../../group-feed.js';
import { libraryKey } from '../../sovran-library.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

async function start(testInfo) {
  const guides = {};
  const cloud = fakeGroupCloud({
    guides,
    students: { sovran_jonjonjonjonjonjonjonjon: { id: 'client-bbbbbbbbbbbb', name: 'Jon' }, sovran_anaanaanaanaanaanaanaana: { id: 'client-cccccccccccc', name: 'Ana' } },
    groups: [{ code: 'SQ01', title: 'Sovran Quest' }, { code: 'SQ02', title: 'Sovran Quest' }],
    posts: [
      { id: 1, tab: 'news', kind: 'homework', body: 'Week 2: meet your Tyrant.', due_on: '2026-11-22', created_at: ago(90), done: ['client-bbbbbbbbbbbb'] },
      { id: 2, tab: 'feed', kind: 'post', student: 'client-bbbbbbbbbbbb', body: 'Took my Tyrant for a walk up the ridge.', created_at: ago(30),
        flags: [{ by: 'client-cccccccccccc', comment: null, at: ago(10) }] },
    ],
  });
  const app = await startServer({ dataDir: testInfo.outputPath('data'), port: 0, readCaptures: false, writeTitles: false, readCalendarsEvery: 0, googleCalendarEvery: 0, googleCalendarSendEvery: 0, mailSyncEvery: 0, phoneDropEvery: 0 });
  const seen = { key: null }; // the key the app last asked with, so the test can play the part of telling the cloud
  useGroup({ fetch: (url, init) => { seen.key = String(init?.headers?.authorization ?? '').replace(/^Bearer /, ''); return cloud.fetcher(url, init); },
    url: 'https://cloud.test/group-feed', keyOf: guideKey, guideApp: true });
  return { app, cloud, guides, seen };
}

test('the guide: key, announcements, hide and pause, flags, people', async ({ page }, testInfo) => {
  const { app, cloud, guides, seen } = await start(testInfo);
  const tabs = page.getByRole('navigation', { name: 'Group Circle' });
  try {
    // No guide key yet: make it, and the page shows only its fingerprint.
    await page.goto(`${app.url}/group`);
    await page.getByRole('button', { name: 'Make my guide key' }).click();
    const line = page.locator('.group-fingerprint');
    await expect(line).toContainText(/fingerprint: [0-9a-f]{64}$/);
    expect(await line.textContent()).not.toContain('guide_');
    // The cloud is told (here, by hand), and Group Circle opens for the guide.
    expect(seen.key).toMatch(/^guide_/);
    guides[seen.key] = 'Daniel';
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(tabs.getByRole('link', { name: 'People' })).toBeVisible();
    await expect(page.locator('.group-done')).toHaveText('1 marked done');

    // Homework to all groups.
    await page.getByLabel('Kind').selectOption('homework');
    await page.getByLabel('Due on').fill('2026-11-29');
    await page.getByLabel('Write an announcement').fill('Week 3: the Manticore.');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.locator('.group-post').first()).toContainText('Week 3: the Manticore.');
    const sent = cloud.state.posts.find((p) => p.body === 'Week 3: the Manticore.');
    expect(sent).toMatchObject({ tab: 'news', kind: 'homework', group: null, due_on: '2026-11-29', comments_on: true });

    // The flag: 1 in the tab, then It's fine.
    await expect(tabs.getByRole('link', { name: /Flags/ })).toContainText('1');
    await tabs.getByRole('link', { name: /Flags/ }).click();
    await expect(page.locator('.group-flag')).toContainText('Took my Tyrant');
    await page.getByRole('button', { name: 'It’s fine' }).click();
    await expect(page.getByText('Nothing to look at.')).toBeVisible();

    // The Circle of SQ01: hide Jon's post, then pause Jon, from its ••• menu.
    await tabs.getByRole('link', { name: 'Circle', exact: true }).click();
    await page.getByLabel('Which group').selectOption('SQ01');
    const jons = page.locator('.group-post', { hasText: 'Took my Tyrant' });
    await jons.getByRole('button', { name: 'More' }).first().click();
    await page.getByRole('menuitem', { name: 'Hide from students' }).click();
    await expect(page.locator('.group-post.group-hidden')).toContainText('hidden from students');
    expect(cloud.state.posts.find((p) => p.id === 2).hidden).toBe(true);
    await page.locator('.group-post', { hasText: 'Took my Tyrant' }).getByRole('button', { name: 'More' }).first().click();
    await page.getByRole('menuitem', { name: /Pause Jon/ }).click();
    await expect.poll(() => cloud.state.asked.some((m) => m.action === 'manage' && m.what === 'pause')).toBe(true);
    // A post of the guide's own in SQ01's Circle.
    await page.getByLabel('Write a post').fill('Lovely to see you all.');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.locator('.group-post').first()).toContainText('Lovely to see you all.');
    expect(cloud.state.posts.find((p) => p.body === 'Lovely to see you all.').group).toBe('SQ01');

    // People: Jon shows as paused; let him post again; rename Ana; make SQ03.
    await tabs.getByRole('link', { name: 'People' }).click();
    const jonRow = page.locator('tr', { has: page.getByLabel('Name for client-bbbbbbbbbbbb') });
    await expect(jonRow).toHaveClass(/group-paused/);
    await jonRow.getByRole('button', { name: 'Let them post again' }).click();
    await expect(page.locator('.group-people-note')).toHaveText('Jon can post again.');
    await expect(page.locator('tr', { has: page.getByLabel('Name for client-bbbbbbbbbbbb') })).not.toHaveClass(/group-paused/);
    await page.getByLabel('Name for client-cccccccccccc').fill('Ana M.');
    await page.locator('tr', { has: page.getByLabel('Name for client-cccccccccccc') }).getByRole('button', { name: 'Save name' }).click();
    await expect(page.locator('.group-people-note')).toHaveText('Name saved: Ana M.');
    await expect(page.getByLabel('Name for client-cccccccccccc')).toHaveValue('Ana M.');
    await page.getByLabel('New group code').fill('sq03');
    await page.getByRole('button', { name: 'Make the group' }).click();
    await expect(page.getByRole('heading', { name: /SQ03/ })).toBeVisible();
    expect(cloud.state.asked.filter((m) => m.action === 'manage').map((m) => m.what)).toEqual(['pause', 'unpause', 'name', 'new_group']);
  } finally {
    await app.close();
    useGroup({ keyOf: libraryKey, guideApp: false });
  }
});

test('the guide sees who reads Group Circle on go Sovran, and can switch one phone off alone', async ({ page }, testInfo) => {
  const { app, cloud, guides, seen } = await start(testInfo);
  cloud.state.phones.set('a'.repeat(64), 'client-bbbbbbbbbbbb'); // Jon's computer made his phone a key
  try {
    await page.goto(`${app.url}/group`);
    await page.getByRole('button', { name: 'Make my guide key' }).click();
    await expect(page.locator('.group-fingerprint')).toBeVisible();
    guides[seen.key] = 'Daniel';
    await page.getByRole('button', { name: 'Check again' }).click();
    await page.getByRole('navigation', { name: 'Group Circle' }).getByRole('link', { name: 'People' }).click();
    const jonRow = page.locator('tr', { has: page.getByLabel('Name for client-bbbbbbbbbbbb') });
    await expect(jonRow.locator('.group-when')).toContainText('reads it on go Sovran too');
    await jonRow.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Switch their phone off' }).click();
    await expect(page.locator('.group-people-note')).toHaveText('Jon\'s phone reads Group Circle no more. Their computer is not touched.');
    expect(cloud.state.phones.size).toBe(0);
    await expect(page.locator('tr', { has: page.getByLabel('Name for client-bbbbbbbbbbbb') }).locator('.group-when')).not.toContainText('go Sovran');
  } finally {
    await app.close();
    useGroup({ keyOf: libraryKey, guideApp: false });
  }
});
