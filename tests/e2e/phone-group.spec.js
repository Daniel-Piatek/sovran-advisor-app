// Group Circle on Sovran Go (phone/group.js, 2026-11-22): with the phone's own Group Circle key, which the student's
// computer leaves sealed on the drop box's shelf, the phone reads Announcements and the Circle, ticks homework, posts,
// comments and replies, as that student. The folder is served as it is; the drop box and the Sovran cloud are stood in
// for (tests/fake-group-cloud.js). Each test runs at an iPhone's size and on an Android phone.

import { test, expect, devices } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { seal, randomB64 } from '../../phone/seal.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const folder = fileURLToPath(new URL('../../phone/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const DROP = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
const GROUP = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/group-feed';
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' };
const { defaultBrowserType: _, ...ANDROID } = devices['Pixel 7'];
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

let server;
let origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html');
    const file = path.join(folder, path.normalize(name));
    if (!file.startsWith(folder) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server.close());

async function phone(browser, testInfo, { withGroup = true } = {}) {
  const link = { box: randomB64(16), drop: randomB64(32), key: randomB64(32) };
  const phoneKey = `phone_${randomB64(32)}`;
  const cloud = fakeGroupCloud({
    students: { sovran_madeupmadeupmadeupmadeup: { id: 'client-aaaaaaaaaaaa', name: 'Maya' }, sovran_jonjonjonjonjonjonjonjon: { id: 'client-bbbbbbbbbbbb', name: 'Jon' } },
    posts: [
      { id: 1, tab: 'news', kind: 'homework', body: 'Week 2: meet your Tyrant. Write one page in your Journal.', due_on: '2026-11-24', created_at: ago(90) },
      { id: 2, tab: 'feed', kind: 'post', student: 'client-bbbbbbbbbbbb', body: 'Took my Tyrant for a walk up the ridge.', created_at: ago(30) },
    ],
  });
  cloud.state.phones.set(sha(phoneKey), 'client-aaaaaaaaaaaa'); // what Maya's computer registered
  const context = await browser.newContext({ ...(testInfo.project.name === 'phone' ? ANDROID : IPHONE) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  const shelf = withGroup ? [{ name: 'group', updated_at: '2026-11-22T20:00:00+00:00', sealed: await seal(link.key, { at: new Date().toISOString(), group: { key: phoneKey, url: GROUP } }) }] : [];
  await page.route(DROP, async (route) => {
    const msg = JSON.parse(route.request().postData());
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (msg.action === 'shelf') return reply(200, { shelf: shelf.map((it) => ({ ...it, ...(msg.have?.[it.name] === it.updated_at ? { sealed: undefined } : {}) })) });
    return reply(400, { error: `Unknown action: ${msg.action}` });
  });
  await page.route(`${GROUP}**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const answer = await cloud.fetcher(req.url(), { method: req.method(), headers: { authorization: req.headers().authorization }, body: req.postData() });
    return route.fulfill({ status: answer.status, headers: { ...CORS, 'content-type': 'application/json' }, body: await answer.text() });
  });
  await context.addInitScript(() => { try { localStorage.setItem('sovran.phone.setup-seen', '1'); } catch { /* not yet */ } });
  await page.goto(`${origin}/#v1.${link.box}.${link.drop}.${link.key}`);
  return { page, context, cloud, errors, phoneKey };
}

test('no Group Circle key on the shelf: no Group Circle choice', async ({ browser }, testInfo) => {
  const { page, context, errors } = await phone(browser, testInfo, { withGroup: false });
  try {
    await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('#group-circle')).toBeHidden();
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('Group Circle on the phone: homework ticked, a post, a comment and a reply, as Maya', async ({ browser }, testInfo) => {
  const { page, context, cloud, errors, phoneKey } = await phone(browser, testInfo);
  try {
    const choice = page.locator('#group-circle');
    await expect(choice).toBeVisible();
    await expect(page.locator('#group-count')).toHaveText('2');
    await choice.click();
    await expect(page.getByRole('heading', { name: 'Group Circle' })).toBeVisible();
    await expect(page.getByText('Week 2: meet your Tyrant.')).toBeVisible();
    await expect(page.locator('.g-kind-homework')).toHaveText('Homework');
    await page.getByLabel('Mark as done').check();
    await expect.poll(() => cloud.state.posts.find((p) => p.id === 1).done).toEqual(['client-aaaaaaaaaaaa']);

    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    await expect(page.getByText('Took my Tyrant for a walk up the ridge.')).toBeVisible();
    await page.getByLabel('Write a post').fill('Sat by the lake before work.');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.locator('.g-post').first()).toContainText('Sat by the lake before work.');
    expect(cloud.state.posts.find((p) => p.body === 'Sat by the lake before work.').student).toBe('client-aaaaaaaaaaaa');

    const jons = page.locator('.g-post[data-post="2"]');
    await jons.getByLabel('Write a comment').fill('Which ridge?');
    await jons.getByRole('button', { name: 'Send' }).click();
    await expect(jons.locator('.g-comment').first()).toContainText('Which ridge?');
    await jons.getByRole('button', { name: 'Reply' }).first().click();
    await jons.getByLabel('Reply to Maya').fill('The one by the lake, too.');
    await jons.getByRole('button', { name: 'Send' }).first().click();
    await expect(jons.locator('.g-reply')).toContainText('The one by the lake, too.');
    // Only the phone's own key went to the cloud, never a library key.
    expect(cloud.state.asked.length).toBeGreaterThan(3);
    expect(errors).toEqual([]);
    void phoneKey;
  } finally { await context.close(); }
});
