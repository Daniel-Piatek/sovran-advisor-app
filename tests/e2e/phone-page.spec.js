// go Sovran (once Sovran Go), the page on the phone (phone/, served from GitHub Pages; module phone-drop). It needs no copy of the
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
    if (msg.action === 'shelf') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"shelf":[]}' }); // nothing on the shelf
    const reply = answer(msg, dropped.length);
    if (reply === 'offline') return route.abort('internetdisconnected');
    if (reply.status < 300) dropped.push(await unseal(link.key, msg.sealed));
    return route.fulfill({ status: reply.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply.body) });
  });
  if (setupSeen) await context.addInitScript(() => { try { localStorage.setItem('sovran.phone.setup-seen', '1'); } catch { /* not yet */ } });
  await page.goto(`${origin}/${query}${linked ? `#v1.${link.box}.${link.drop}.${link.key}` : ''}`);
  return { page, context, dropped, errors, link };
}

test('go Sovran opens on the writing box, then Ask my Sovran Advisor and My Reports; the Advisor is a link that opens Claude', async ({ browser }, testInfo) => {
  const { page, context, errors } = await phone(browser, testInfo);
  await expect(page).toHaveTitle('go Sovran');
  // The name is the owner's own logo, as supplied, in the middle of the top.
  const logo = page.getByRole('img', { name: 'go Sovran' });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await logo.evaluate((img) => { const r = img.getBoundingClientRect(); return Math.abs((r.left + r.right) / 2 - innerWidth / 2); })).toBeLessThan(2);
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeAttached();
  // The writing box comes first: the three kinds on one row, From Me chosen, and Save waits for words.
  await expect(page.locator('#text')).toHaveAttribute('placeholder', 'What’s on your mind?');
  await expect(page.getByRole('radio')).toHaveText(['From Me', 'From Other', 'Journal']);
  await expect(page.getByRole('radio', { name: 'From Me' })).toBeChecked();
  expect(new Set(await page.getByRole('radio').evaluateAll((all) => all.map((c) => Math.round(c.getBoundingClientRect().top)))).size).toBe(1);
  await expect(page.locator('#where')).toHaveText('Goes to your Inbox');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(page.locator('.choice:visible strong')).toHaveText(['Ask my Sovran Advisor', 'My Reports']);
  const ask = page.getByRole('link', { name: /Ask my Sovran Advisor/ });
  await expect(ask).toHaveAttribute('href', 'https://claude.ai/new');
  await expect(ask).toHaveAttribute('target', '_blank'); // a real tapped link: the phone hands it to the Claude app
  await expect(ask).toContainText('Ask for insight from your reports, your charts and the Sovran Library');
  // Nothing is wider than the screen, every choice is a full finger tall, and so are the kinds and Save.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const box of await page.locator('.choice:visible').evaluateAll((all) => all.map((c) => c.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(56);
  for (const box of await page.locator('.chip, #keep').evaluateAll((all) => all.map((c) => c.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(40);
  expect(errors).toEqual([]);
  await context.close();
});

test('From Me and From Other are sealed and kept for the Inbox; Continue goes back to the first screen', async ({ browser }, testInfo) => {
  const { page, context, dropped, errors } = await phone(browser, testInfo);
  await page.locator('#text').fill('Ask Sam about the venue');
  await expect(page.locator('#where')).toHaveText('Goes to your Inbox');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kept' })).toBeVisible();
  await expect(page.locator('#done-tag')).toHaveText('From Me');
  await expect(page.locator('#done-words')).toHaveText('It will be in your Inbox when your computer is on.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#text')).toBeVisible();
  await expect(page.locator('#text')).toHaveValue('');
  await page.getByRole('radio', { name: 'From Other' }).click();
  await expect(page.getByRole('radio', { name: 'From Other' })).toBeChecked();
  await expect(page.locator('#text')).toBeFocused();
  await page.locator('#text').fill('Ana: “call me back”');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#done-tag')).toHaveText('From Other');
  // After Continue the box is empty and back on From Me.
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('radio', { name: 'From Me' })).toBeChecked();
  expect(dropped.map((n) => [n.world, n.body, n.kind])).toEqual([['inner', 'Ask Sam about the venue', undefined], ['outer', 'Ana: “call me back”', undefined]]);
  expect(errors).toEqual([]);
  await context.close();
});

test('a journal entry carries its day and goes to the Journal', async ({ browser }, testInfo) => {
  const { page, context, dropped, errors } = await phone(browser, testInfo);
  await expect(page.locator('#form-day')).toBeHidden();
  await page.getByRole('radio', { name: 'Journal' }).click();
  await expect(page.locator('#form-day')).toBeVisible();
  await expect(page.locator('#where')).toHaveText('Goes into today’s Journal');
  await page.locator('#text').fill('Walked by the sea.\nClear head.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Added' })).toBeVisible();
  await expect(page.locator('#done-tag')).toHaveText('Journal entry');
  await expect(page.locator('#done-words')).toHaveText('It will be in your Journal when your computer is on.');
  const [note] = dropped;
  expect(note.kind).toBe('journal');
  expect(note.body).toBe('Walked by the sea.\nClear head.');
  expect(note.day).toBe(await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }));
  expect(Math.abs(Date.now() - new Date(note.at).getTime())).toBeLessThan(60_000);
  expect(errors).toEqual([]);
  await context.close();
});

test('changing the kind, or looking at My Reports and coming back, loses no words; nothing to keep sends nothing', async ({ browser }, testInfo) => {
  const { page, context, dropped } = await phone(browser, testInfo);
  await page.locator('#text').fill('Half a thought');
  await page.getByRole('radio', { name: 'Journal' }).click();
  await expect(page.locator('#text')).toHaveValue('Half a thought');
  await page.getByRole('radio', { name: 'From Other' }).click();
  await expect(page.locator('#text')).toHaveValue('Half a thought');
  await page.getByRole('button', { name: /My Reports/ }).click();
  await expect(page.getByRole('heading', { name: 'My Reports' })).toBeVisible();
  await page.goBack(); // the phone's own Back goes to the first screen
  await expect(page.locator('#text')).toHaveValue('Half a thought');
  await expect(page.getByRole('radio', { name: 'From Other' })).toBeChecked();
  // Nothing to keep: Save stays asleep, and nothing is sent, even by the keyboard's own Send.
  await page.locator('#text').fill('   ');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.locator('#form').evaluate((form) => form.requestSubmit());
  await expect(page.locator('#text')).toBeVisible();
  expect(dropped).toEqual([]);
  await context.close();
});

test('without signal the words wait on the phone and go later, each to its own place', async ({ browser }, testInfo) => {
  let online = false;
  const { page, context, dropped } = await phone(browser, testInfo, { answer: () => (online ? { status: 200, body: { kept: true } } : 'offline') });
  await page.getByRole('radio', { name: 'Journal' }).click();
  await page.locator('#text').fill('Written on the train');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Saved' })).toBeVisible();
  await expect(page.locator('#done-words')).toContainText('Saved on this phone');
  await page.getByRole('button', { name: 'Continue' }).click();
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
  await page.getByRole('radio', { name: 'From Other' }).click();
  await page.locator('#text').fill('Do not lose me');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('This link has been replaced. Scan the new code on your computer.');
  await expect(page.locator('#text')).toHaveValue('Do not lose me');
  await expect(page.getByRole('radio', { name: 'From Other' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled(); // to try again
  expect(await page.evaluate(() => localStorage.getItem('sovran.phone.waiting'))).toBeNull();
  await context.close();
});

test('the first visit shows how to add go Sovran to the home screen; without a link it says how to get one', async ({ browser }, testInfo) => {
  const first = await phone(browser, testInfo, { setupSeen: false });
  await expect(first.page.getByRole('heading', { name: 'Add go Sovran to your home screen' })).toBeVisible();
  await expect(first.page.locator(testInfo.project.name === 'phone' ? '#steps-android' : '#steps-ios')).toBeVisible();
  await expect(first.page.locator('.foot')).toBeVisible(); // the sealed-words line is said here, not on the first screen
  if (testInfo.project.name === 'phone') await expect(first.page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'capture.webmanifest');
  await first.page.getByRole('link', { name: 'Use it here for now' }).click();
  await expect(first.page.locator('#text')).toBeVisible();
  await expect(first.page.locator('.foot')).toBeHidden();
  await first.context.close();
  const none = await phone(browser, testInfo, { linked: false });
  await expect(none.page.getByText('This phone isn’t linked yet.')).toBeVisible();
  await expect(none.page.locator('#choose')).toBeHidden();
  await none.context.close();
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'capture.webmanifest'), 'utf8'));
  expect([manifest.name, manifest.short_name]).toEqual(['go Sovran', 'go Sovran']);
});

test('in the dark the boxes stay readable and Save stays red', async ({ browser }, testInfo) => {
  const { page, context } = await phone(browser, testInfo);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#text').fill('Night thought');
  const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (r * 299 + g * 587 + b * 114) / 1000; };
  const seen = await page.evaluate(() => ({ page: getComputedStyle(document.body).backgroundColor, card: getComputedStyle(document.getElementById('form')).backgroundColor,
    words: getComputedStyle(document.getElementById('text')).color, save: getComputedStyle(document.getElementById('keep')).backgroundColor }));
  expect(lum(seen.page)).toBeLessThan(60);
  expect(lum(seen.words) - lum(seen.card)).toBeGreaterThan(150);
  expect(seen.save).toBe('rgb(199, 31, 66)'); // red in the dark too, the owner's call (22 Nov 2026)
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('keep')).backgroundColor)).toBe('rgb(199, 31, 66)'); // red, the owner's call
  await context.close();
});

test('a phone told to use ChatGPT opens ChatGPT instead', async ({ browser }, testInfo) => {
  const { page, context } = await phone(browser, testInfo, { query: '?ai=chatgpt' });
  const ask = page.getByRole('link', { name: /Ask my Sovran Advisor/ });
  await expect(ask).toHaveAttribute('href', 'https://chatgpt.com/');
  await expect(page.locator('#ask-line')).toHaveText('Ask for insight from your reports, your charts and the Sovran Library'); // the same line for either AI
  await context.close();
});
