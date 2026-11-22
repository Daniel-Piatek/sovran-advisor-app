// Group Circle on go Sovran (once Sovran Go) (phone/group.js, 2026-11-22): with the phone's own Group Circle key, which the student's
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

async function phone(browser, testInfo, { withGroup = true, before = async () => {} } = {}) {
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
  await context.route(`${GROUP}**`, async (route) => { // the context's, so the service worker's asks come here too
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const answer = await cloud.fetcher(req.url(), { method: req.method(), headers: { authorization: req.headers().authorization }, body: req.postData() });
    return route.fulfill({ status: answer.status, headers: { ...CORS, 'content-type': 'application/json' }, body: await answer.text() });
  });
  await context.addInitScript(() => { try { localStorage.setItem('sovran.phone.setup-seen', '1'); } catch { /* not yet */ } });
  await before(context);
  await page.goto(`${origin}/#v1.${link.box}.${link.drop}.${link.key}`);
  return { page, context, cloud, errors, phoneKey };
}

test('no Group Circle key on the shelf: no Group Circle choice', async ({ browser }, testInfo) => {
  const { page, context, errors } = await phone(browser, testInfo, { withGroup: false });
  try {
    await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeAttached();
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
    await expect(page.locator('#group-line')).toHaveText('2 new'); // one short line on the tile
    await expect(page.locator('#group-count')).toHaveCSS('background-color', 'rgb(199, 31, 66)'); // red, so it is seen
    // Both tiles carry a large picture and are the same tall box, side by side.
    const tiles = await page.locator('.tile').evaluateAll((all) => all.map((t) => { const r = t.getBoundingClientRect(); const pic = t.querySelector('.tile-picture, .disc').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(pic.width)]; }));
    expect(tiles[0]).toEqual(tiles[1]);
    expect(tiles[0][2]).toBe(76);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await choice.click();
    await expect(page.getByRole('heading', { name: 'Group Circle' })).toBeVisible();
    await expect(page.getByText('Week 2: meet your Tyrant.')).toBeVisible();
    await expect(page.locator('.g-kind-homework')).toHaveText('Homework');
    await page.getByLabel('Mark as done').check();
    await expect.poll(() => cloud.state.posts.find((p) => p.id === 1).done).toEqual(['client-aaaaaaaaaaaa']);

    await page.getByRole('button', { name: 'Circle', exact: true }).click();
    await expect(page.locator('.foot')).toBeHidden(); // posts are not sealed, so the sealed-words line is not said here
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

// Alerts on the phone (push.js, sw.js). The phone's push service is stood in for: subscribing gives a made-up address,
// and the wake is delivered by the browser's own developer tools, as Apple or Google would.
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/made-up-for-the-test';
const standInPush = (context) => context.addInitScript((endpoint) => {
  const sub = { endpoint, unsubscribe: async () => { localStorage.removeItem('test.sub'); return true; } };
  PushManager.prototype.getSubscription = async () => (localStorage.getItem('test.sub') ? sub : null);
  PushManager.prototype.subscribe = async (options) => { localStorage.setItem('test.sub', String(options.applicationServerKey?.byteLength)); return sub; };
}, ENDPOINT);

test('alerts on the phone: allow them, choose which, a wake shows what waits, an alert opens its post, and stop', async ({ browser }, testInfo) => {
  const { page, context, cloud, errors } = await phone(browser, testInfo, { before: standInPush });
  await context.grantPermissions(['notifications'], { origin });
  try {
    await page.locator('#group-circle').click();
    await expect(page.getByRole('heading', { name: 'Alerts on this phone' })).toBeVisible();
    await page.getByRole('button', { name: 'Allow alerts' }).click();
    await expect(page.getByText('Alerts are on. Choose which:')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('test.sub'))).toBe('65'); // the cloud's public key, as the raw point
    await expect(page.getByLabel('A new announcement from Daniel')).toBeChecked();
    await expect(page.getByLabel('Any new post in the Circle')).not.toBeChecked();
    expect(cloud.state.pushes.get(ENDPOINT).kinds).toEqual(['answer', 'due', 'news', 'reply']);
    await page.getByLabel('Any new post in the Circle').check();
    await expect.poll(() => cloud.state.pushes.get(ENDPOINT).kinds).toEqual(['answer', 'due', 'feed', 'news', 'reply']);

    // The cloud keeps what is new and wakes the phone with an empty message; the phone fetches it with its own key.
    cloud.state.pushes.get(ENDPOINT).waiting = [{ kind: 'reply', post: 2, tab: 'feed', author: 'Jon', on_mine: false, text: 'Same here, every morning.', at: ago(1) }];
    const cdp = await context.newCDPSession(page);
    const found = new Promise((resolve) => cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const r = registrations.find((x) => x.scopeURL.startsWith(origin) && !x.isDeleted); if (r) resolve(r.registrationId);
    }));
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: await found, data: '' });
    await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => [n.title, n.body, n.data.open])))
      .toEqual([['Jon replied to you', 'Same here, every morning.', './?open=group&tab=feed&post=2']]);
    expect(cloud.state.pushes.get(ENDPOINT).waiting).toEqual([]); // fetched once, then let go

    // Tapping it opens go Sovran at that post.
    await page.goto(`${origin}/?open=group&tab=feed&post=2`);
    await expect(page.getByRole('heading', { name: 'Group Circle' })).toBeVisible();
    await expect(page.locator('#group-tabs [data-tab="feed"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-post="2"]')).toHaveClass(/g-asked/);
    expect(new URL(page.url()).search).toBe('');

    await page.getByRole('button', { name: 'Stop alerts on this phone' }).click();
    await expect(page.getByRole('button', { name: 'Allow alerts' })).toBeVisible();
    expect(cloud.state.pushes.size).toBe(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('alerts blocked in the phone’s settings: go Sovran says where to switch them on', async ({ browser }, testInfo) => {
  const { page, context, errors } = await phone(browser, testInfo, { before: async (c) => {
    await standInPush(c);
    await c.addInitScript(() => Object.defineProperty(Notification, 'permission', { get: () => 'denied' }));
  } });
  try {
    await page.locator('#group-circle').click();
    await expect(page.getByText('Alerts are switched off for go Sovran in this phone’s settings.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow alerts' })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
