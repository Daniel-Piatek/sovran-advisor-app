// My reports on Sovran Go (phone/reports.js): the student's reports read on the phone from the sealed copies their
// computer puts on the drop box's shelf (phone-shelf.js), with highlights and comments that go back sealed. The
// folder is served as it is and the drop box is stood in for; the copies are made by the app's own code, so the
// phone draws what a real computer would send. Each test runs at an iPhone's size and on an Android phone.

import { test, expect, devices } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seal, unseal, randomB64 } from '../../phone/seal.js';
import { shelfReport } from '../../phone-shelf.js';

const folder = fileURLToPath(new URL('../../phone/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const DROP = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' };
const { defaultBrowserType: _, ...ANDROID } = devices['Pixel 7'];

// A made-up report, in the shape the Sovran Library gives one.
const PATTERN = { id: 7, report: 'pattern', title: 'Your Sovran Pattern Report', version: 2, approved_on: '2026-11-17T17:47:00Z', words: 5300, sections: [
  { section_key: 'before-you-begin', title: 'Before You Begin', level: 1, position: 1, parent: null, body: 'This report is a mirror, not a definition. Read it slowly.\n\nYou are **already whole**.' },
  { section_key: 'your-gifts', title: 'Your Gifts', level: 1, position: 2, parent: null, body: 'You notice what others walk past. The quiet knowing has been there all along.\n\n<div class="break"></div>\n\nYou notice what is needed before it is said.' },
  { section_key: 'a-part-inside', title: 'A Part Inside', level: 2, position: 3, parent: 'your-gifts', body: 'A quieter part of you keeps watch.' },
  { section_key: 'the-door', title: 'The Door That Opens', level: 1, position: 4, parent: null, body: 'What may come is yours to meet.' },
] };
const LIST = { reports: [{ report: 'pattern', title: PATTERN.title, version: 2, approved_on: PATTERN.approved_on, words: 5300, about: 'Rooted in your own design, your Pattern shows your gifts and your challenges as one whole.' }] };
const mark = (over = {}) => ({ id: '11111111-1111-4111-8111-111111111111', report: 'pattern', version: 2, section_key: 'your-gifts', quote: 'quiet knowing', prefix: 'others walk past. The ', suffix: ' has been there all along.', comment: '', created_at: '2026-11-17T10:00:00.000Z', updated_at: '2026-11-17T10:00:00.000Z', asks: [], ...over });

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

// A linked phone and its drop box. shelf: what the computer put there ({ name: words }); it can be changed mid-test
// with put(). online(false): no signal. dropped: the notes the phone left, opened.
async function phone(browser, testInfo, { shelf = { list: LIST, 'report.pattern': { report: shelfReport(PATTERN) }, marks: { marks: [] } }, query = '' } = {}) {
  const link = { box: randomB64(16), drop: randomB64(32), key: randomB64(32) };
  const context = await browser.newContext({ ...(testInfo.project.name === 'phone' ? ANDROID : IPHONE), permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text()); });
  const dropped = [];
  const shelves = new Map();
  let stamp = 0;
  const put = async (name, words) => { if (words === null) shelves.delete(name); else shelves.set(name, { updated_at: `2026-11-18T00:00:${String(++stamp).padStart(2, '0')}+00:00`, sealed: await seal(link.key, { at: new Date().toISOString(), ...words }) }); };
  for (const [name, words] of Object.entries(shelf ?? {})) await put(name, words);
  let signal = true;
  let hasShelf = shelf !== null;
  const asked = [];
  await page.route(DROP, async (route) => {
    if (!signal) return route.abort('internetdisconnected');
    const msg = JSON.parse(route.request().postData());
    asked.push(msg);
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (msg.action === 'shelf') {
      if (!hasShelf) return reply(400, { error: 'Unknown action: shelf' }); // an older drop box
      return reply(200, { shelf: [...shelves].map(([name, it]) => ({ name, updated_at: it.updated_at, ...(msg.have?.[name] === it.updated_at ? {} : { sealed: it.sealed }) })) });
    }
    if (msg.action === 'drop') { dropped.push(await unseal(link.key, msg.sealed)); return reply(200, { kept: true }); }
    return reply(400, { error: `Unknown action: ${msg.action}` });
  });
  await context.addInitScript(() => { try { localStorage.setItem('sovran.phone.setup-seen', '1'); } catch { /* not yet */ } });
  await page.goto(`${origin}/${query}#v1.${link.box}.${link.drop}.${link.key}`);
  return { page, context, dropped, errors, link, put, asked, online: (on) => { signal = on; } };
}
const openPattern = async (page) => {
  await page.getByRole('button', { name: /My reports/ }).click();
  await page.locator('.report-card[data-report="pattern"]').click();
  await expect(page.getByRole('heading', { name: 'Your Sovran Pattern Report' })).toBeVisible();
};
// Selects words in a section as a finger would: the selection is set, and the page hears that it changed.
const select = (page, section, words) => page.evaluate(([key, text]) => {
  const root = document.querySelector(`[data-section="${key}"] .report-text`);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.data.indexOf(text);
    if (at === -1) continue;
    const range = document.createRange();
    range.setStart(node, at); range.setEnd(node, at + text.length);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return true;
  }
  return false;
}, [section, words]);

test('My reports lists the report in Ivory & Gold and opens it to read, part by part', async ({ browser }, testInfo) => {
  const { page, context, errors } = await phone(browser, testInfo);
  const card = page.getByRole('button', { name: /My reports/ });
  await expect(card).toContainText('Read your Sovran reports');
  await card.click();
  await expect(page.getByRole('heading', { name: 'My reports' })).toBeVisible();
  const report = page.locator('.report-card');
  await expect(report).toHaveCount(1);
  await expect(report.locator('.report-card-label')).toHaveText('Sovran report');
  await expect(report.locator('.report-card-title')).toHaveText('Your Sovran Pattern Report');
  await expect(report.locator('.report-card-about')).toContainText('Rooted in your own design');
  await expect(report.locator('.report-card-meta')).toContainText('Version 2');
  await expect(report).toHaveCSS('background-color', 'rgb(251, 248, 239)'); // brand Ivory
  await report.click();
  await expect(page.locator('.report-title')).toHaveText('Your Sovran Pattern Report');
  await expect(page.locator('.report-wordmark')).toBeVisible();
  await expect(page.locator('.report-part-label')).toHaveText(['Part One', 'Part Two']);
  await expect(page.locator('.report-section-title')).toHaveText(['Before You Begin', 'Your Gifts', 'A Part Inside', 'The Door That Opens']);
  await expect(page.locator('[data-section="your-gifts"] .report-text > p').first()).toHaveClass(/report-lede/); // the drop cap
  await expect(page.locator('[data-section="before-you-begin"] strong')).toHaveText('already whole');
  await expect(page.locator('.report-break')).toHaveCount(1); // the break line is a gold bar, never text
  await expect(page.locator('.report-paper')).not.toContainText('class="break"');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(251, 248, 239)');
  expect(Number((await page.locator('.report-text').first().evaluate((n) => parseFloat(getComputedStyle(n).lineHeight) / parseFloat(getComputedStyle(n).fontSize))).toFixed(2))).toBe(1.44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Contents jump to a part; Back goes to the list, then to the choices (the phone's own Back too).
  await page.getByRole('button', { name: 'The Door That Opens' }).click();
  await expect(page.locator('#section-the-door')).toBeInViewport();
  await page.getByRole('button', { name: '‹ My reports' }).click();
  await expect(page.getByRole('heading', { name: 'My reports' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(48, 45, 45)');
  expect(errors).toEqual([]);
  await context.close();
});

test('selected words can be highlighted: it shows at once, goes sealed to the computer, and stays after a reload', async ({ browser }, testInfo) => {
  const { page, context, dropped, errors } = await phone(browser, testInfo);
  await openPattern(page);
  await expect(page.locator('#pick')).toBeHidden();
  expect(await select(page, 'your-gifts', 'uiet knowin')).toBe(true); // part of two words: taken whole
  await expect(page.locator('#pick')).toBeVisible();
  await expect(page.locator('#pick button, #pick a')).toHaveText(['Highlight', 'Comment', 'Ask my AI']);
  for (const h of await page.locator('#pick button, #pick a').evaluateAll((all) => all.map((b) => b.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
  // Clear of the phone's own bars: never on the bottom edge (Android's search bar sits there), at the top when the words are low.
  const place = await page.locator('#pick').evaluate((bar) => ({ top: bar.classList.contains('is-top'), gap: window.innerHeight - bar.getBoundingClientRect().bottom, y: bar.getBoundingClientRect().top }));
  if (place.top) expect(place.y).toBeLessThan(40); else expect(place.gap).toBeGreaterThanOrEqual(100);
  await page.locator('#pick-highlight').click();
  await expect(page.locator('#pick')).toBeHidden();
  await expect(page.locator('mark.report-mark')).toHaveText('quiet knowing');
  await expect.poll(() => dropped.length).toBe(1);
  const [note] = dropped;
  expect(note).toMatchObject({ kind: 'mark', op: 'add', report: 'pattern', version: 2, section_key: 'your-gifts', quote: 'quiet knowing', comment: '' });
  expect(note.prefix.endsWith('walk past. The ')).toBe(true);
  expect(note.suffix.startsWith(' has been there')).toBe(true);
  expect(note.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  // The computer has not been on yet: the highlight is still there after the page is opened again.
  await page.reload();
  await openPattern(page);
  await expect(page.locator('mark.report-mark')).toHaveText('quiet knowing');
  expect(errors).toEqual([]);
  await context.close();
});

test('a comment shows under its part; it can be changed, and the highlight removed with a second tap', async ({ browser }, testInfo) => {
  const { page, context, dropped, errors } = await phone(browser, testInfo);
  await openPattern(page);
  await select(page, 'the-door', 'yours to meet');
  await page.locator('#pick-comment').click();
  await expect(page.locator('#sheet')).toBeVisible();
  await expect(page.locator('.sheet-quote')).toHaveText('“yours to meet”');
  await page.locator('.sheet-text').fill('This lands today.');
  await page.getByRole('button', { name: 'Save comment' }).click();
  await expect(page.locator('#sheet')).toBeHidden();
  await expect(page.locator('mark.report-mark.has-comment')).toHaveText('yours to meet');
  const note = page.locator('[data-section="the-door"] .report-note');
  await expect(note).toContainText('This lands today.');
  await expect.poll(() => dropped.length).toBe(1);
  expect(dropped[0]).toMatchObject({ kind: 'mark', op: 'add', quote: 'yours to meet', comment: 'This lands today.' });
  // Change it (from the note, or by tapping the words).
  await note.click();
  await expect(page.locator('.sheet-text')).toHaveValue('This lands today.');
  await page.locator('.sheet-text').fill('This lands today, and tomorrow.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(note).toContainText('and tomorrow.');
  await expect.poll(() => dropped.length).toBe(2);
  expect(dropped[1]).toMatchObject({ kind: 'mark', op: 'comment', id: dropped[0].id, comment: 'This lands today, and tomorrow.', was: 'This lands today.' });
  // Remove: asked twice, so a slip of the finger removes nothing.
  await page.locator('mark.report-mark').click();
  await page.getByRole('button', { name: 'Remove highlight' }).click();
  await expect(page.locator('mark.report-mark')).toHaveCount(1);
  await page.getByRole('button', { name: 'Tap again to remove' }).click();
  await expect(page.locator('mark.report-mark')).toHaveCount(0);
  await expect(page.locator('.report-note')).toHaveCount(0);
  await expect.poll(() => dropped.length).toBe(3);
  expect(dropped[2]).toMatchObject({ kind: 'mark', op: 'remove', id: dropped[0].id });
  expect(errors).toEqual([]);
  await context.close();
});

test('highlights, comments and questions made on the computer show on the phone, and both sides end up the same', async ({ browser }, testInfo) => {
  const fromComputer = mark({ comment: 'From my desk.', asks: [{ role: 'user', text: 'What is this knowing?' }, { role: 'assistant', text: 'It is the part of you that already sees.' }] });
  const { page, context, dropped, put, errors } = await phone(browser, testInfo, { shelf: { list: LIST, 'report.pattern': { report: shelfReport(PATTERN) }, marks: { marks: [fromComputer] } } });
  await openPattern(page);
  await expect(page.locator('mark.report-mark.has-comment.has-ask')).toHaveText('quiet knowing');
  const note = page.locator('[data-section="your-gifts"] .report-note');
  await expect(note).toContainText('From my desk.');
  await expect(note).toContainText('You asked: What is this knowing?');
  await note.click();
  await expect(page.locator('.sheet-answer')).toHaveText('It is the part of you that already sees.');
  await page.getByRole('button', { name: 'Close' }).click();
  // One made here; then the computer collects it and its own copy says so: nothing is shown twice.
  await select(page, 'before-you-begin', 'a mirror');
  await page.locator('#pick-highlight').click();
  await expect(page.locator('mark.report-mark')).toHaveCount(2);
  await expect.poll(() => dropped.length).toBe(1);
  const mine = dropped[0];
  await put('marks', { marks: [fromComputer, mark({ id: mine.id, section_key: mine.section_key, quote: mine.quote, prefix: mine.prefix, suffix: mine.suffix, updated_at: new Date(Date.now() + 5000).toISOString() })] });
  await page.reload();
  await openPattern(page);
  await expect(page.locator('mark.report-mark')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sovran.phone.marks') ?? '[]').length)).toBe(0); // nothing waits any more
  // Removed on the computer: gone here too.
  await put('marks', { marks: [] });
  await page.reload();
  await openPattern(page);
  await expect(page.locator('mark.report-mark')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('Ask my AI opens the AI’s own app with the words in its box, and copies them too', async ({ browser }, testInfo) => {
  const { page, context, dropped, errors } = await phone(browser, testInfo);
  await openPattern(page);
  await select(page, 'your-gifts', 'You notice what others walk past.');
  const ask = page.locator('#pick-ask');
  await expect(ask).toHaveAttribute('href', 'https://claude.ai/new');
  await expect(ask).toHaveAttribute('target', '_blank');
  await context.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Claude</title>' }));
  const [opened] = await Promise.all([context.waitForEvent('page'), ask.click()]);
  const words = 'From my Sovran Pattern Report: “You notice what others walk past.”\n\nMy question: ';
  expect(opened.url()).toBe('https://claude.ai/new?q=' + encodeURIComponent(words)); // the words arrive in Claude's box
  await opened.close();
  await expect(page.locator('#toast')).toHaveText('Opening Claude with your words in the box. Add your question.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('From my Sovran Pattern Report: “You notice what others walk past.”\n\nMy question: ');
  await expect(page.locator('#pick')).toBeHidden();
  expect(dropped).toEqual([]); // asking leaves no highlight
  expect(errors).toEqual([]);
  await context.close();
});

test('for ChatGPT the copied words ask for the Sovran Library and for the offer to keep the chat', async ({ browser }, testInfo) => {
  const { page, context, errors } = await phone(browser, testInfo, { query: '?ai=chatgpt' });
  await openPattern(page);
  await select(page, 'your-gifts', 'You notice what others walk past.');
  await context.route('https://chatgpt.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>ChatGPT</title>' }));
  const [opened] = await Promise.all([context.waitForEvent('page'), page.locator('#pick-ask').click()]);
  expect(opened.url()).toBe('https://chatgpt.com/');
  await page.bringToFront();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('From my Sovran Pattern Report: “You notice what others walk past.”\n\nPlease use my Sovran Library to answer. After your answer, ask me if I would like this chat kept in my Sovran Advisor.\n\nMy question: ');
  expect(errors).toEqual([]);
  await context.close();
});

test('a report already on the phone reads without signal; a highlight made then goes when signal is back', async ({ browser }, testInfo) => {
  const { page, context, dropped, online } = await phone(browser, testInfo);
  await openPattern(page);
  online(false);
  await page.reload();
  await openPattern(page);
  await expect(page.locator('[data-section="the-door"] .report-text')).toHaveText('What may come is yours to meet.');
  await select(page, 'the-door', 'What may come');
  await page.locator('#pick-highlight').click();
  await expect(page.locator('mark.report-mark')).toHaveText('What may come');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sovran.phone.waiting') ?? '[]').length)).toBe(1); // it waits on the phone
  expect(dropped).toEqual([]);
  online(true);
  await page.evaluate(() => dispatchEvent(new Event('online')));
  await expect.poll(() => dropped.length).toBe(1);
  expect(dropped[0]).toMatchObject({ kind: 'mark', op: 'add', quote: 'What may come' });
  await context.close();
});

test('before the computer has been on, or with an older drop box, My reports says what to do', async ({ browser }, testInfo) => {
  for (const shelf of [{}, null]) {
    const { page, context, errors } = await phone(browser, testInfo, { shelf });
    await page.getByRole('button', { name: /My reports/ }).click();
    await expect(page.locator('.reports-empty')).toContainText('once your computer has been on');
    await expect(page.locator('.report-card')).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  }
});
