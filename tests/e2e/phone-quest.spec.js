// Sovran Quest on go Sovran (phone/quest.js, 2026-11-23, the owner's design): the student's Quest weeks read with the
// phone's own Group Circle key; their Done and journal entries from the computer's sealed shelf; a Done or an entry made
// on the phone goes back sealed through the drop box; the transcript is read and searched; Stuck? Ask Daniel. The folder
// is served as it is; the drop box and the Sovran cloud are stood in for. Each test runs at an iPhone's size and on an
// Android phone.

import { test, expect, devices } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { seal, unseal, randomB64 } from '../../phone/seal.js';
import { fakeGroupCloud } from '../fake-group-cloud.js';

const folder = fileURLToPath(new URL('../../phone/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const DROP = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/phone-drop';
const GROUP = 'https://lpqzqnmwsxnojvpcqwiy.supabase.co/functions/v1/group-feed';
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' };
const { defaultBrowserType: _, ...ANDROID } = devices['Pixel 7'];
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

const SUMMARY = 'We explored wholeness as the natural state of the Sovran Self rather than something to earn, and met the Tyrant: the part of us at war with ourselves. '
  + 'Daniel walked the group through the STOP practice and how to notice the Tyrant without fighting it.';
const TRANSCRIPT = '### **00:41:05**\n**Daniel Piatek:** So this week I want you to notice the Tyrant. Not to fight it.\n### **00:41:22**\n**Ana Silva:** Mine came out at work on Tuesday.\n'
  + '### **00:41:40**\n**Daniel Piatek:** Good. Write that moment down. What did the Tyrant want from you?';
const WEEKS = [
  { number: 2, title: 'Meeting the Tyrant', call_on: '2026-11-23', practice_url: 'https://q.example.com/practice', replay_url: 'https://drive.example.com/replay2', summary: SUMMARY, transcript: TRANSCRIPT,
    homework: [{ text: 'Write in your Journal about one moment the Tyrant showed up this week.', where: 'journal' },
      { text: 'Read your Sovran Pattern report. Ask Sovran Advisor about anything you don’t understand.', where: 'advisor' },
      { text: 'Walk twenty minutes a day, without your phone.', where: 'elsewhere' }] },
  { number: 1, title: 'Wholeness', call_on: '2026-11-16', homework: [{ text: 'Sit for ten minutes each morning.', where: 'elsewhere' }], transcript: '' },
];

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

async function phone(browser, testInfo, { guide = false, weeks = WEEKS } = {}) {
  const link = { box: randomB64(16), drop: randomB64(32), key: randomB64(32) };
  const phoneKey = `phone_${randomB64(32)}`;
  const cloud = fakeGroupCloud({ students: { sovran_madeupmadeupmadeupmadeup: { id: 'client-aaaaaaaaaaaa', name: 'Maya', group: 'SQ01' } },
    guides: { guide_madeupmadeupmadeupmadeupmadeup: 'Daniel' }, questWeeks: weeks });
  if (guide) cloud.state.guidePhones.set(sha(phoneKey), 'Daniel');
  else cloud.state.phones.set(sha(phoneKey), 'client-aaaaaaaaaaaa');
  const context = await browser.newContext({ ...(testInfo.project.name === 'phone' ? ANDROID : IPHONE) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // What Maya's computer left on the shelf: the Group Circle key, and her Quest so far (piece 1 of Week 2: Done, one entry).
  const shelfAt = new Date(Date.now() - 3600_000).toISOString();
  const shelf = [
    { name: 'group', updated_at: shelfAt, sealed: await seal(link.key, { at: shelfAt, group: { key: phoneKey, url: GROUP } }) },
    { name: 'quest', updated_at: shelfAt, sealed: await seal(link.key, { at: shelfAt, marks: [{ week: 'SQ01-2', piece: 1, done: true, entries: 1, last: '2026-11-24' }] }) },
  ];
  const notes = [];
  await page.route(DROP, async (route) => {
    const msg = JSON.parse(route.request().postData());
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });
    if (msg.action === 'shelf') return reply(200, { shelf: shelf.map((it) => ({ ...it, ...(msg.have?.[it.name] === it.updated_at ? { sealed: undefined } : {}) })) });
    if (msg.action === 'drop') { notes.push(await unseal(link.key, msg.sealed)); return reply(200, { ok: true }); }
    return reply(400, { error: `Unknown action: ${msg.action}` });
  });
  await context.route(`${GROUP}**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const answer = await cloud.fetcher(req.url(), { method: req.method(), headers: { authorization: req.headers().authorization }, body: req.postData() });
    return route.fulfill({ status: answer.status, headers: { ...CORS, 'content-type': 'application/json' }, body: await answer.text() });
  });
  await context.addInitScript(() => { try { localStorage.setItem('sovran.phone.setup-seen', '1'); } catch { /* not yet */ } });
  await page.goto(`${origin}/#v1.${link.box}.${link.drop}.${link.key}`);
  return { page, context, cloud, errors, notes };
}

test('the first screen: My Reports as wide as Ask my Sovran Advisor, then Sovran Quest and Group Circle as two squares', async ({ browser }, testInfo) => {
  const { page, context, errors } = await phone(browser, testInfo);
  try {
    await expect(page.locator('#quest-tile')).toBeVisible();
    await expect(page.locator('.choice:visible strong')).toHaveText(['Ask my Sovran Advisor', 'My Reports', 'Sovran Quest', 'Group Circle']);
    await expect(page.locator('#quest-line')).toHaveText('Week 2 · 1 of 3 done');
    const box = (id) => page.locator(id).evaluate((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
    const [ask, reports, quest, group] = await Promise.all(['#ask', '#my-reports', '#quest-tile', '#group-circle'].map(box));
    expect(reports[2]).toBe(ask[2]);
    expect(reports[3]).toBe(ask[3]); // the same size
    expect(quest[1]).toBe(group[1]);
    expect(quest[3]).toBe(group[3]); // side by side, the same tall box
    expect(quest[2]).toBe(group[2]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('a week on the phone: Done goes to the computer, Start in my Journal writes an entry for the piece, the transcript searches', async ({ browser }, testInfo) => {
  const { page, context, cloud, errors, notes } = await phone(browser, testInfo);
  try {
    await page.locator('#quest-tile').click();
    await expect(page.getByRole('heading', { name: 'Sovran Quest' })).toBeVisible();
    await expect(page.locator('#quest-weeks button')).toHaveText(['Week 2', 'Week 1']);
    await expect(page.locator('#quest-weeks button[aria-pressed="true"]')).toHaveText('Week 2');
    await expect(page.locator('.q-name')).toHaveText('Meeting the Tyrant');
    await expect(page.locator('.q-when')).toHaveText(/^Call Monday,? (23 November|November 23)$/);
    await expect(page.getByRole('link', { name: /Open today’s practice/ })).toHaveAttribute('href', 'https://q.example.com/practice');
    const pieces = page.locator('.q-piece');
    await expect(pieces).toHaveCount(3);
    await expect(pieces.nth(0).locator('.q-done')).toHaveText('✓ Done');
    await expect(pieces.nth(0).locator('.q-work')).toContainText('1 Journal entry');
    await expect(pieces.nth(1).getByRole('link', { name: 'Ask my Sovran Advisor' })).toHaveAttribute('href', /^https:\/\/claude\.ai\/new\?q=I'm%20working/);
    await expect(pieces.nth(2).locator('.q-start')).toHaveCount(0); // done elsewhere: only Done

    // Done on piece 3: sealed for the computer, and shown at once.
    await pieces.nth(2).getByRole('button', { name: 'Done' }).click();
    await expect(pieces.nth(2).locator('.q-done')).toHaveText('✓ Done');
    await expect.poll(() => notes.find((n) => n.kind === 'quest_done')).toMatchObject({ group: 'SQ01', number: 2, piece: 3, on: true });

    // The summary, then all of it.
    await expect(page.locator('.q-sum')).toHaveText(/…$/);
    await page.getByRole('button', { name: 'Read the whole summary' }).click();
    await expect(page.locator('.q-sum')).toHaveText(SUMMARY);
    await expect(page.getByRole('link', { name: /Watch the replay/ })).toHaveAttribute('href', 'https://drive.example.com/replay2');

    // Start in my Journal: write on the phone; it goes to the computer named for the piece.
    await pieces.nth(0).getByRole('button', { name: 'Start in my Journal' }).click();
    await expect(page.getByRole('heading', { name: 'Homework 1' })).toBeVisible();
    await expect(page.locator('#quest-write-label')).toHaveText('Sovran Quest · Week 2 · Homework 1');
    await page.getByLabel('Your journal entry').fill('At work on Tuesday the old voice said I had to fix it all myself.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Sovran Quest' })).toBeVisible();
    await expect(page.locator('#toast')).toContainText('in your Journal when your computer is on');
    const entry = notes.find((n) => n.kind === 'journal');
    expect(entry).toMatchObject({ body: 'At work on Tuesday the old voice said I had to fix it all myself.', quest: { group: 'SQ01', number: 2, piece: 1, text: WEEKS[0].homework[0].text } });
    await expect(page.locator('.q-piece').nth(0).locator('.q-work')).toContainText('2 Journal entries');

    // The transcript, asked for when opened, with search.
    await page.getByRole('button', { name: 'Read the transcript ›' }).click();
    await expect(page.getByRole('heading', { name: 'Week 2 transcript' })).toBeVisible();
    await expect(page.locator('#quest-tr-lines p')).toHaveCount(3);
    await page.getByLabel('Search the call').fill('tyrant');
    await expect(page.locator('#quest-tr-found-words')).toHaveText('2 places · 1 of 2');
    await expect(page.locator('#quest-tr-lines mark')).toHaveCount(2);
    await page.getByRole('button', { name: 'Next place' }).click();
    await expect(page.locator('#quest-tr-found-words')).toHaveText('2 places · 2 of 2');
    expect(cloud.state.asked.filter((a) => a.action === 'quest_transcript')).toHaveLength(1);
    await page.locator('#quest-tr-back').click();

    // Stuck? Ask Daniel: a question with the week, through Tell Daniel, as Maya.
    await page.getByRole('button', { name: 'Stuck? Ask Daniel' }).click();
    await page.getByLabel('Your question for Daniel').fill('What counts as the Tyrant showing up?');
    await page.getByRole('button', { name: 'Send to Daniel' }).click();
    await expect(page.locator('#toast')).toContainText('Sent to Daniel');
    expect(cloud.state.tells.at(-1)).toMatchObject({ student_id: 'client-aaaaaaaaaaaa', kind: 'question', why: 'What counts as the Tyrant showing up?', context: { quest: 'Sovran Quest · Week 2', from: 'go Sovran' } });

    // Week 1, then back to the first screen: the tile counts the Done.
    await page.getByRole('button', { name: 'Week 1' }).click();
    await expect(page.locator('.q-name')).toHaveText('Wholeness');
    await page.locator('#quest-back').click();
    await expect(page.locator('#quest-line')).toHaveText('Week 2 · 2 of 3 done');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('no Quest weeks for the group: no Sovran Quest square; Daniel’s own phone sees the weeks without Done or the starts', async ({ browser }, testInfo) => {
  const none = await phone(browser, testInfo, { weeks: [] });
  try {
    await expect(none.page.locator('#group-circle')).toBeVisible();
    await none.page.waitForTimeout(400);
    await expect(none.page.locator('#quest-tile')).toBeHidden();
    expect(none.errors).toEqual([]);
  } finally { await none.context.close(); }
  const { page, context, errors } = await phone(browser, testInfo, { guide: true });
  try {
    await expect(page.locator('#quest-line')).toHaveText('Week 2');
    await page.locator('#quest-tile').click();
    await expect(page.locator('.q-piece')).toHaveCount(3);
    await expect(page.locator('.q-done, .q-start, .q-stuck')).toHaveCount(0);
    await page.getByRole('button', { name: 'Read the transcript ›' }).click();
    await expect(page.locator('#quest-tr-lines p')).toHaveCount(3);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('the homework and the summary show as Daniel formatted them, and the AI gets the words alone', async ({ browser }, testInfo) => {
  const weeks = [{ ...WEEKS[0],
    summary: 'We met the *Tyrant*.\n\n- Notice it\n- [Name it]{.underline}',
    homework: [{ text: 'Write about **[one moment]{.c-violet}** the Tyrant [showed up]{.hl-yellow}.', where: 'journal' },
      { text: 'Ask about ~~it~~ [your pattern](https://example.com/p) and <b>this</b>.', where: 'advisor' },
      { text: '**[SELF-COMMAND]{.c-grey}**\\\nNotice one moment.\n\n- Breathe\\\n  and wait', where: 'journal' }] }];
  const { page, context, errors } = await phone(browser, testInfo, { weeks });
  try {
    await page.locator('#quest-tile').click();
    const pieces = page.locator('.q-piece');
    await expect(pieces.nth(0).locator('.q-rich')).toHaveText('Write about one moment the Tyrant showed up.');
    await expect(pieces.nth(0).locator('strong .fc-violet')).toHaveText('one moment');
    await expect(pieces.nth(0).locator('mark.hl-yellow')).toHaveText('showed up');
    await expect(pieces.nth(1).locator('s')).toHaveText('it');
    await expect(pieces.nth(1).getByRole('link', { name: 'your pattern' })).toHaveAttribute('href', 'https://example.com/p');
    await expect(pieces.nth(1).locator('.q-rich')).toContainText('<b>this</b>'); // shown as words, never as HTML
    await expect(pieces.nth(1).getByRole('link', { name: 'Ask my Sovran Advisor' })).toHaveAttribute('href', /Ask%20about%20it%20your%20pattern%20and%20%3Cb%3Ethis%3C%2Fb%3E\.%E2%80%9D/);
    // A line break after a heading (Shift-Enter on the computer) is a line break, never a "\\" (2026-11-24, the owner's wish).
    await expect(pieces.nth(2).locator('.q-rich')).not.toContainText('\\');
    await expect(pieces.nth(2).locator('.q-rich p').first()).toHaveText('SELF-COMMANDNotice one moment.');
    await expect(pieces.nth(2).locator('.q-rich p br')).toHaveCount(1);
    await expect(pieces.nth(2).locator('.q-rich li')).toHaveText('Breatheand wait');
    await expect(page.locator('.q-sum em')).toHaveText('Tyrant');
    await expect(page.locator('.q-sum li')).toHaveText(['Notice it', 'Name it']);
    await expect(page.locator('.q-sum li u')).toHaveText('Name it');
    await pieces.nth(0).getByRole('button', { name: 'Start in my Journal' }).click();
    await expect(page.locator('#quest-write-quote .fc-violet')).toHaveText('one moment');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
