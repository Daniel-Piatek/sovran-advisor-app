// Sovran Go, the page on the phone (phone/, served from GitHub Pages; module phone-drop). It needs no copy of the
// app: the folder is served as it is, and the Sovran drop box is stood in for. Each test runs at an iPhone's size
// (the large-screen project) and on an Android phone (the phone project).

import { test, expect, devices } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unseal, randomB64 } from '../../phone/seal.js';

const folder = fileURLToPath(new URL('../../phone/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const DROP = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' };
const { defaultBrowserType: _, ...ANDROID } = devices['Pixel 7'];

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

// A phone with its link, past the home-screen steps; the drop box answers as told and remembers what it was given.
async function phone(browser, testInfo, { answer = () => ({ status: 200, body: { kept: true } }), setupSeen = true, linked = true, query = '' } = {}) {
  const link = { box: randomB64(16), drop: randomB64(32), key: randomB64(32) };
  const context = await browser.newContext(testInfo.project.name === 'phone' ? ANDROID : IPHONE);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  const dropped = [];
  await page.route(DROP, async (route) => {
    const msg = JSON.parse(route.request().postData());
    const reply = answer(msg, dropped.length);
    if (reply === 'offline') return route.abort('internetdisconnected');
    if (reply.status < 300) dropped.push(await unseal(link.key, msg.sealed));
    return route.fulfill({ status: reply.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply.body) });
  });
  if (setupSeen) await context.addInitScript(() => { try { localStorage.setItem('sovran.phone.setup-seen', '1'); } catch { /* not yet */ } });
  await page.goto(`${origin}/${query}${linked ? `#v1.${link.box}.${link.drop}.${link.key}` : ''}`);
  return { page, context, dropped, errors, link };
}

test('Sovran Go opens on four choices, and Ask my AI is a link that opens Claude', async ({ browser }, testInfo) => {
  const { page, context, errors } = await phone(browser, testInfo);
  await expect(page).toHaveTitle('Sovran Go');
  await expect(page.locator('.band-name')).toHaveText('Sovran Go');
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await expect(page.locator('.choice strong')).toHaveText(['Ask my AI', 'Journal entry', 'My own thought', 'From someone else']);
  const ask = page.getByRole('link', { name: /Ask my AI/ });
  await expect(ask).toHaveAttribute('href', 'https://claude.ai/new');
  await expect(ask).toHaveAttribute('target', '_blank'); // a real tapped link: the phone hands it to the Claude app
  await expect(ask).toContainText('Ask Claude');
  // Nothing is wider than the screen, and every choice is a full finger tall.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const box of await page.locator('.choice').evaluateAll((all) => all.map((c) => c.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(56);
  expect(errors).toEqual([]);
  await context.close();
});

test('my own thought and from someone else are sealed and kept for the Inbox', async ({ browser }, testInfo) => {
  const { page, context, dropped, errors } = await phone(browser, testInfo);
  await page.getByRole('button', { name: /My own thought/ }).click();
  await expect(page.getByRole('heading', { name: 'My own thought' })).toBeVisible();
  await expect(page.locator('#text')).toBeFocused();
  await page.locator('#text').fill('Ask Sam about the venue');
  await page.getByRole('button', { name: 'Keep in Inbox' }).click();
  await expect(page.getByRole('heading', { name: 'Kept' })).toBeVisible();
  await expect(page.locator('#done-tag')).toHaveText('My own thought');
  await expect(page.locator('#done-words')).toHaveText('It will be in your Inbox when your computer is on.');
  await page.getByRole('button', { name: 'Add another' }).click();
  await expect(page.locator('#text')).toHaveValue('');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('button', { name: /From someone else/ }).click();
  await page.locator('#text').fill('Ana: “call me back”');
  await page.getByRole('button', { name: 'Keep in Inbox' }).click();
  await expect(page.locator('#done-tag')).toHaveText('From someone else');
  expect(dropped.map((n) => [n.world, n.body, n.kind])).toEqual([['inner', 'Ask Sam about the venue', undefined], ['outer', 'Ana: “call me back”', undefined]]);
  expect(errors).toEqual([]);
  await context.close();
});

test('a journal entry carries its day and goes to the Journal', async ({ browser }, testInfo) => {
  const { page, context, dropped, errors } = await phone(browser, testInfo);
  await page.getByRole('button', { name: /Journal entry/ }).click();
  await expect(page.getByRole('heading', { name: 'Journal entry' })).toBeVisible();
  await expect(page.locator('#form-day')).toBeVisible();
  await page.locator('#text').fill('Walked by the sea.\nClear head.');
  await page.getByRole('button', { name: 'Add to my Journal' }).click();
  await expect(page.getByRole('heading', { name: 'Added' })).toBeVisible();
  await expect(page.locator('#done-words')).toHaveText('It will be in your Journal when your computer is on.');
  const [note] = dropped;
  expect(note.kind).toBe('journal');
  expect(note.body).toBe('Walked by the sea.\nClear head.');
  expect(note.day).toBe(await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }));
  expect(Math.abs(Date.now() - new Date(note.at).getTime())).toBeLessThan(60_000);
  expect(errors).toEqual([]);
  await context.close();
});

test('Back loses nothing, and the phone’s own Back goes to the choices', async ({ browser }, testInfo) => {
  const { page, context, dropped } = await phone(browser, testInfo);
  await page.getByRole('button', { name: /My own thought/ }).click();
  await page.locator('#text').fill('Half a thought');
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await page.getByRole('button', { name: /Journal entry/ }).click();
  await expect(page.locator('#text')).toHaveValue('');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await page.getByRole('button', { name: /My own thought/ }).click();
  await expect(page.locator('#text')).toHaveValue('Half a thought');
  // Nothing to keep: nothing is sent.
  await page.locator('#text').fill('   ');
  await page.getByRole('button', { name: 'Keep in Inbox' }).click();
  await expect(page.getByRole('heading', { name: 'My own thought' })).toBeVisible();
  expect(dropped).toEqual([]);
  await context.close();
});

test('without signal the words wait on the phone and go later, each to its own place', async ({ browser }, testInfo) => {
  let online = false;
  const { page, context, dropped } = await phone(browser, testInfo, { answer: () => (online ? { status: 200, body: { kept: true } } : 'offline') });
  await page.getByRole('button', { name: /Journal entry/ }).click();
  await page.locator('#text').fill('Written on the train');
  await page.getByRole('button', { name: 'Add to my Journal' }).click();
  await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();
  await expect(page.locator('#done-words')).toContainText('Saved on this phone');
  await page.getByRole('button', { name: 'Add another' }).click();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.locator('#waiting-line')).toHaveText('1 waits on this phone for signal.');
  expect(dropped).toEqual([]);
  // Opened again with signal (the link is remembered): what waited goes by itself, still a journal entry.
  online = true;
  await page.goto(`${origin}/`);
  await expect(page.locator('#waiting-line')).toHaveText('1 saved earlier is sent.');
  expect(dropped.map((n) => [n.kind, n.body])).toEqual([['journal', 'Written on the train']]);
  await context.close();
});

test('a thought that waited from before this update still goes through', async ({ browser }, testInfo) => {
  const { page, context, dropped } = await phone(browser, testInfo);
  // As the earlier page kept it: no kind.
  await page.evaluate(() => localStorage.setItem('sovran.phone.waiting', JSON.stringify([{ body: 'From before the update', world: 'outer', at: '2026-11-16T08:00:00.000Z' }])));
  await page.goto(`${origin}/`);
  await expect(page.locator('#waiting-line')).toHaveText('1 saved earlier is sent.');
  expect(dropped).toEqual([{ body: 'From before the update', world: 'outer', at: '2026-11-16T08:00:00.000Z' }]);
  await context.close();
});

test('a replaced link says so and keeps the words in the box', async ({ browser }, testInfo) => {
  const { page, context } = await phone(browser, testInfo, { answer: () => ({ status: 404, body: { error: 'This link has been replaced. Scan the new code on your computer.' } }) });
  await page.getByRole('button', { name: /From someone else/ }).click();
  await page.locator('#text').fill('Do not lose me');
  await page.getByRole('button', { name: 'Keep in Inbox' }).click();
  await expect(page.locator('#status')).toHaveText('This link has been replaced. Scan the new code on your computer.');
  await expect(page.locator('#text')).toHaveValue('Do not lose me');
  expect(await page.evaluate(() => localStorage.getItem('sovran.phone.waiting'))).toBeNull();
  await context.close();
});

test('the first visit shows how to add Sovran Go to the home screen; without a link it says how to get one', async ({ browser }, testInfo) => {
  const first = await phone(browser, testInfo, { setupSeen: false });
  await expect(first.page.getByRole('heading', { name: 'Add Sovran Go to your home screen' })).toBeVisible();
  await expect(first.page.locator(testInfo.project.name === 'phone' ? '#steps-android' : '#steps-ios')).toBeVisible();
  if (testInfo.project.name === 'phone') await expect(first.page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'capture.webmanifest');
  await first.page.getByRole('link', { name: 'Use it here for now' }).click();
  await expect(first.page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await first.context.close();
  const none = await phone(browser, testInfo, { linked: false });
  await expect(none.page.getByText('This phone isn’t linked yet.')).toBeVisible();
  await expect(none.page.locator('#choose')).toBeHidden();
  await none.context.close();
  expect(JSON.parse(fs.readFileSync(path.join(folder, 'capture.webmanifest'), 'utf8')).name).toBe('Sovran Go');
});

test('a phone told to use ChatGPT opens ChatGPT instead', async ({ browser }, testInfo) => {
  const { page, context } = await phone(browser, testInfo, { query: '?ai=chatgpt' });
  await expect(page.getByRole('link', { name: /Ask my AI/ })).toHaveAttribute('href', 'https://chatgpt.com/');
  await expect(page.locator('#ask-line')).toContainText('Ask ChatGPT');
  await context.close();
});
