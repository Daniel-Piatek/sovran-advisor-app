// Invitations in a mail (advanced/mail/12): a card with y, Shift Y and n. Google and Gmail are stood in for; nothing real is sent.
import { test, expect } from './fixtures.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';

const j = (app, url, method, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const rows = (page) => page.getByRole('list', { name: 'Conversations' }).getByRole('listitem');
const card = (page) => page.getByRole('region', { name: 'Invitation: Garden party' });
const eventsOn = async (app) => (await fetch(`${app.url}/api/events?from=2026-11-14&to=2026-11-14`).then((r) => r.json()));

async function setUp(app, { send = true } = {}) {
  const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  await j(app, '/api/google/client', 'PUT', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await follow(await j(app, '/api/google/connect', 'POST', {}));
  const [account] = (await fetch(`${app.url}/api/google`).then((r) => r.json())).accounts;
  await follow(await j(app, `/api/google/accounts/${account.id}`, 'PATCH', { permission: 'mail.read', on: true }));
  if (send) await follow(await j(app, `/api/google/accounts/${account.id}`, 'PATCH', { permission: 'mail.send', on: true }));
  const text = makeMailbox({ filler: 0 }).text.replaceAll('demo@example.com', 'work@mypractice.com');
  expect((await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: 'work@mypractice.com' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'w.mbox' }, body: Buffer.from(text) })).status).toBe(200);
}

async function openInvitation(page, app) {
  await page.goto(`${app.url}/mail?split=calendar`);
  await rows(page).first().click();
  await expect(card(page)).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
}

test('the invitation is a card: the meeting, the place, who asked, and three keys; the text of the mail stays below', async ({ page, app }) => {
  await setUp(app);
  await openInvitation(page, app);
  const c = card(page);
  await expect(c).toContainText('Garden party');
  await expect(c).toContainText('Saturday 14 November, 15:00 to 18:00');
  await expect(c).toContainText("At Zoe's garden");
  await expect(c).toContainText('From Zoe Dubois');
  await expect(c.getByRole('button')).toHaveText([/Yes\s*y/, /Maybe\s*⇧Y/, /No\s*n/]);
  await expect(page.locator('.mail-message .mail-text')).toContainText('You are invited to our garden party');
});

test('y: it says Yes, the meeting is on Saturday at 15:00, and Accepted goes to the organiser as a calendar file once; Shift Y changes it without a second event', async ({ page, app }) => {
  test.setTimeout(90_000);
  await setUp(app);
  await openInvitation(page, app);
  await page.keyboard.press('y');
  await expect(card(page).locator('.invite-status')).toContainText('You said Yes · in your Calendar');
  await expect(card(page).getByRole('button', { name: /Yes/ })).toHaveAttribute('aria-pressed', 'true');
  expect((await eventsOn(app)).map((e) => [e.title, e.starts_at, e.ends_at])).toEqual([['Garden party', '2026-11-14T15:00', '2026-11-14T18:00']]);
  expect(app.gmail.outgoing.length).toBe(0); // the ten seconds
  await expect(card(page).locator('.invite-status')).toContainText('Accepted sent by mail', { timeout: 30_000 });
  expect(app.gmail.outgoing.length).toBe(1);
  const raw = app.gmail.outgoing[0].raw;
  expect(raw).toMatch(/^To: zoe@example.org$/m);
  expect(raw).toMatch(/^Subject: Accepted: Garden party$/m);
  const calendar = Buffer.from(raw.split(/Content-Type: text\/calendar; method=REPLY; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n/)[1].split('\r\n--')[0].replace(/\s+/g, ''), 'base64').toString();
  expect(calendar).toContain('METHOD:REPLY');
  expect(calendar).toContain('UID:garden-party-2026@example.org');
  expect(calendar).toContain('PARTSTAT=ACCEPTED');

  await page.keyboard.press('Shift+Y'); // changed my mind: maybe
  await expect(card(page).locator('.invite-status')).toContainText('You said Maybe');
  expect((await eventsOn(app)).length).toBe(1); // answering again never makes a second event
  await page.reload();
  await expect(card(page).locator('.invite-status')).toContainText('You said Maybe · in your Calendar'); // kept
});

test('n on a new invitation changes nothing on the day; Undo within the ten seconds sends nothing', async ({ page, app }) => {
  await setUp(app);
  await openInvitation(page, app);
  await page.keyboard.press('n');
  await expect(card(page).locator('.invite-status')).toContainText('You said No · not on your Calendar');
  expect(await eventsOn(app)).toEqual([]);
  await card(page).getByRole('button', { name: 'Undo' }).click();
  await expect(card(page).locator('.invite-status')).toHaveCount(0); // as if unanswered
  const [send] = await fetch(`${app.url}/api/mail/sends`).then((r) => r.json());
  expect(send.state).toBe('undone');
  expect(app.gmail.outgoing.length).toBe(0);
});

test('without “Send mail as you” the meeting is on your day and the card says the answer waits', async ({ page, app }) => {
  await setUp(app, { send: false });
  await openInvitation(page, app);
  await page.keyboard.press('y');
  await expect(card(page).locator('.invite-status')).toContainText('You said Yes · in your Calendar');
  await expect(card(page).locator('.invite-status')).toContainText('Send mail as you', { timeout: 15_000 });
  expect((await eventsOn(app)).length).toBe(1);
  expect(app.gmail.outgoing.length).toBe(0);
});

test('the keys are in the palette and the panel; the Library draws the card', async ({ page, app }) => {
  await setUp(app);
  await page.goto(`${app.url}/mail?split=calendar`);
  await page.keyboard.press('ControlOrMeta+k');
  for (const name of [/Invitation: Yes/, /Invitation: Maybe/, /Invitation: No/]) await expect(page.getByRole('option', { name })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.locator('.mail-times-table tr[data-key="yes"], .mail-times-table tr[data-key="no"]')).toHaveCount(2);
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('region', { name: 'Invitation: Kick-off Nordlicht' }).first()).toBeVisible();
});
