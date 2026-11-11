// Mail (advanced/mail/2): Mail has its place after the Inbox; a Takeout .mbox is given to Mail › Import, read one
// message at a time, and every message is a row in the app's own database. Safe to run twice. The mailbox is made up
// (scripts/demo-mail.js): no real mail, no Google.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from './fixtures.js';
import { makeMailbox } from '../../scripts/demo-mail.js';

const mailbox = (testInfo, filler = 40) => {
  const file = testInfo.outputPath('takeout.mbox');
  fs.writeFileSync(file, makeMailbox({ filler }).text);
  return file;
};
const section = (page, name) => page.getByRole('region', { name, exact: true });
const get = (app, url) => fetch(app.url + url).then((r) => r.json());

async function importFile(page, file, address = 'demo@example.com') {
  await page.getByLabel('Mail address').fill(address);
  await page.getByLabel('Choose a Takeout .mbox file').setInputFiles(file);
  await page.getByRole('button', { name: 'Import' }).click();
}

test('Mail sits after the Inbox, and with nothing imported it says so', async ({ page, app, isMobile }) => {
  await page.goto(`${app.url}/mail`);
  await expect(page.getByRole('heading', { name: 'Mail', level: 1 })).toBeVisible();
  await expect(page.getByText('No mail yet.')).toBeVisible();
  await page.getByRole('link', { name: /Import and sync/ }).click();
  await expect(page).toHaveURL(`${app.url}/mail/import`);
  await expect(page.getByRole('heading', { name: 'Import and sync', level: 1 })).toBeVisible();
  await expect(section(page, 'Your mail')).toContainText('Nothing is kept yet.');
  await expect(section(page, 'Files read in')).toContainText('No file read in yet.');
  await expect(section(page, 'In your database')).toContainText('No mail yet.');
  await expect(page.getByRole('button', { name: 'Import' })).toBeDisabled();
  const links = page.getByRole('navigation', { name: 'Sections' }).getByRole('link');
  if (isMobile) {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitem', { name: 'Mail' })).toBeVisible();
  } else {
    const names = await links.allTextContents();
    expect(names.indexOf('Mail')).toBe(names.indexOf('Inbox') + 1);
    await expect(links.filter({ hasText: 'Mail' })).toHaveAttribute('aria-current', 'page');
  }
});

test('give it the Takeout file: the count per label, the files read in, and the conversations that are rows now', async ({ page, app }, testInfo) => {
  await page.goto(`${app.url}/mail/import`);
  await importFile(page, mailbox(testInfo));
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toHaveText('Imported: 48 messages read, 48 new, 0 here already.');
  await expect(page.getByRole('list', { name: 'Messages read so far, by label' }).getByText('Inbox')).toBeVisible();

  await expect(section(page, 'Your mail')).toContainText('48 messages in');
  await expect(section(page, 'Your mail')).toContainText('over 9 labels');
  const inbox = section(page, 'Your mail').locator('[data-label="Inbox"]');
  await expect(inbox).toContainText('Gmail');
  await expect(section(page, 'Your mail').locator('[data-label="Finance"]')).toContainText('Yours');
  await expect(section(page, 'Your mail').locator('[data-label="Category Promotions"]')).toContainText('Gmail category');

  const imported = section(page, 'Files read in').locator('.mail-import-row');
  await expect(imported).toHaveCount(1);
  await expect(imported).toContainText('takeout.mbox');
  await expect(imported).toContainText('Imported · 48 messages, 48 new, 0 here already');
  await expect(imported).toContainText('demo@example.com');

  const rows = section(page, 'In your database').getByRole('listitem');
  const lena = rows.filter({ hasText: 'Onboarding call on Thursday?' });
  await expect(lena).toContainText('Demo Owner, Lena Fischer');
  await expect(lena).toContainText('Perfect, see you Thursday at 10.');
  await expect(lena).toContainText('3 messages');
  await expect(rows.filter({ hasText: 'Invoice 2026-114' })).toContainText('1 message');
  await expect(rows.filter({ hasText: 'Eingeladen: Gartenfest' })).toContainText('Zoë Dubois');

  // the database holds what the page says
  const overview = await get(app, '/api/mail');
  expect([overview.messages, overview.labels.length]).toEqual([48, 9]);
});

test('reading the same file again adds nothing; a newer export adds only what is new', async ({ page, app }, testInfo) => {
  await page.goto(`${app.url}/mail/import`);
  await importFile(page, mailbox(testInfo, 40));
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toContainText('48 new');
  await importFile(page, mailbox(testInfo, 40));
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toHaveText('Imported: 48 messages read, 0 new, 48 here already.');
  await importFile(page, mailbox(testInfo, 45));
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toHaveText('Imported: 53 messages read, 5 new, 48 here already.');
  await expect(section(page, 'Your mail')).toContainText('53 messages in');
  await expect(section(page, 'Files read in').locator('.mail-import-row')).toHaveCount(3);
  expect((await get(app, '/api/mail')).messages).toBe(53);
});

test('an address that is not one is refused, and nothing is read', async ({ page, app }, testInfo) => {
  await page.goto(`${app.url}/mail/import`);
  await importFile(page, mailbox(testInfo), 'not an address');
  await expect(page.getByRole('alert').filter({ hasText: 'Which address' })).toBeVisible();
  expect((await get(app, '/api/mail')).messages).toBe(0);
  await page.getByLabel('Mail address').fill('demo@example.com');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toContainText('48 new');
});

test('the file can be dropped, the way a person drops it', async ({ page, app }) => {
  await page.goto(`${app.url}/mail/import`);
  await page.getByLabel('Mail address').fill('demo@example.com');
  const zone = page.locator('.mail-drop');
  const data = await page.evaluateHandle((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'dropped.mbox', { type: 'application/mbox' }));
    return transfer;
  }, makeMailbox({ filler: 4 }).text);
  await zone.dispatchEvent('dragenter', { dataTransfer: data });
  await zone.dispatchEvent('dragover', { dataTransfer: data });
  await expect(zone).toHaveClass(/is-over/);
  await zone.dispatchEvent('drop', { dataTransfer: data });
  await expect(page.locator('.mail-chosen')).toContainText('dropped.mbox');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toContainText('12 new');
});

test('search finds conversations by their words, and the address is remembered for the next file', async ({ page, app }, testInfo) => {
  await page.goto(`${app.url}/mail/import`);
  await importFile(page, mailbox(testInfo), 'Demo@Example.com');
  await expect(section(page, 'Your mail')).toContainText('48 messages');
  const rows = section(page, 'In your database').getByRole('listitem');
  await page.getByLabel('Search your mail').fill('garden party');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Eingeladen: Gartenfest');
  await page.getByLabel('Search your mail').fill('nothing like this');
  await expect(section(page, 'In your database')).toContainText('No conversation has those words.');
  await page.reload();
  await expect(page.getByLabel('Mail address')).toHaveValue('demo@example.com');
});

test('with Mail switched off the screen and its place go, and every message is still there when it is back', async ({ page, app }, testInfo) => {
  await page.goto(`${app.url}/mail/import`);
  await importFile(page, mailbox(testInfo));
  await expect(section(page, 'Your mail')).toContainText('48 messages');

  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="mail"]').getByRole('button', { name: 'Off', exact: true }).click();
  await page.goto(`${app.url}/mail`);
  await expect(page.getByText('Mail is switched off. Everything it kept is still here.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Mail' })).toBeHidden();
  expect((await get(app, '/api/mail')).messages).toBe(48);

  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="mail"]').getByRole('button', { name: 'On', exact: true }).click();
  await page.goto(`${app.url}/mail`);
  await expect(page.getByRole('tab', { name: /Important/ })).toBeVisible();
  await page.goto(`${app.url}/mail/import`);
  await expect(section(page, 'Your mail')).toContainText('48 messages');
});

// ---- Mail 3: fill from Gmail, counted on both sides, attachments kept once (Gmail and Google are stood in for) ----
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';
import { messagesOf, mailboxOf } from '../fake-gmail.js';

const post = (app, url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());

// Google signed in as work@mypractice.com with Read your mail on, the export in the app, and Gmail holding 17 more.
async function withGmail(app, testInfo, { newest = 17 } = {}) {
  const everything = messagesOf(makeMailbox({ filler: 40 }).text).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  app.gmail.messages = everything;
  const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  await fetch(`${app.url}/api/google/client`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET }) });
  await follow(await post(app, '/api/google/connect', {}));
  const [account] = (await fetch(`${app.url}/api/google`).then((r) => r.json())).accounts;
  await follow(await fetch(`${app.url}/api/google/accounts/${account.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permission: 'mail.read', on: true }) }).then((r) => r.json()));
  const file = testInfo.outputPath('export.mbox');
  fs.writeFileSync(file, mailboxOf(everything.slice(0, everything.length - newest)));
  return file;
}

test('Fill from Gmail brings in what came after the export; Counted on both sides is equal; the file is kept once', async ({ page, app }, testInfo) => {
  const file = await withGmail(app, testInfo);
  await page.goto(`${app.url}/mail/import`);
  await expect(page.getByLabel('Mail address')).toHaveValue('work@mypractice.com'); // the signed-in Google account
  await importFile(page, file, 'work@mypractice.com');
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toContainText('31 new'); // 48 - 17
  await expect(section(page, 'Fill from Gmail')).toContainText('Everything newer than your export');

  await section(page, 'Fill from Gmail').getByRole('button', { name: 'Check the counts' }).click();
  await expect(section(page, 'Fill from Gmail').getByRole('status')).toContainText('Some labels differ.');
  await expect(section(page, 'Fill from Gmail').locator('.count-row[data-equal="false"]').first()).toContainText('to fill');
  await expect(section(page, 'Fill from Gmail').locator('.count-row[data-label="All mail"] .count-number')).toHaveText(['48', '31']);

  await section(page, 'Fill from Gmail').getByRole('button', { name: 'Fill from Gmail' }).click();
  await expect(section(page, 'Fill from Gmail').getByRole('status')).toContainText('Filled: 17 messages from Gmail.');
  await expect(section(page, 'Your mail')).toContainText('48 messages in');

  await section(page, 'Fill from Gmail').getByRole('button', { name: 'Check the counts' }).click();
  await expect(section(page, 'Fill from Gmail').getByRole('status')).toContainText('Every label is equal');
  await expect(section(page, 'Fill from Gmail').locator('.count-row[data-equal="false"]')).toHaveCount(0);
  await expect(section(page, 'Fill from Gmail').locator('.count-row[data-label="All mail"]')).toContainText('Equal');
  await expect(section(page, 'Fill from Gmail').getByRole('button', { name: 'Fill what is missing' })).toBeHidden();

  // Again: nothing newer.
  await section(page, 'Fill from Gmail').getByRole('button', { name: 'Fill from Gmail' }).click();
  await expect(section(page, 'Fill from Gmail').getByRole('status')).toContainText('Nothing newer: you are up to date.');
  await expect(section(page, 'Files read in').locator('.mail-import-row')).toHaveCount(3);

  // The PDF in two mails is one file in the files.
  await expect(section(page, 'Your mail')).toContainText('attachments kept in your files, 1 different file, each stored once');
  const files = fs.readdirSync(path.join(app.dataDir, 'files')).filter((f) => !f.startsWith('.'));
  expect(files.length).toBe(1);
});

test('without “Read your mail” the Fill and the count are not offered, and the page says where to switch it on', async ({ page, app }, testInfo) => {
  await page.goto(`${app.url}/mail/import`);
  await importFile(page, mailbox(testInfo), 'someone@example.com');
  await expect(section(page, 'Your mail')).toContainText('48 messages');
  await expect(section(page, 'Fill from Gmail')).toContainText('Sign in with Google and switch on “Read your mail”');
  await expect(section(page, 'Fill from Gmail').getByRole('button', { name: 'Fill from Gmail' })).toBeDisabled();
  await expect(section(page, 'Fill from Gmail').getByRole('button', { name: 'Check the counts' })).toBeDisabled();
  expect(app.gmail.seen.length).toBe(0);
});

test('the Library shows the Count check row', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Count check row', level: 2 })).toBeVisible();
  await expect(page.locator('.count-row[data-label="Finance"]')).toContainText('1 to fill');
  await expect(page.locator('.count-row[data-label="Inbox"]')).toContainText('Equal');
});

// ---- Mail 4: live with Gmail ----

async function liveSetup(app, testInfo, { modify = true } = {}) {
  const file = await withGmail(app, testInfo, { newest: 0 });
  if (modify) {
    const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
    const [account] = (await fetch(`${app.url}/api/google`).then((r) => r.json())).accounts;
    await follow(await fetch(`${app.url}/api/google/accounts/${account.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permission: 'mail.modify', on: true }) }).then((r) => r.json()));
  }
  return file;
}

test('Live with Gmail: off until switched on; Sync now; a change made in Gmail comes in; one made here waits, goes, and the sync line says so', async ({ page, app }, testInfo) => {
  const file = await liveSetup(app, testInfo);
  await page.goto(`${app.url}/mail/import`);
  await importFile(page, file, 'work@mypractice.com');
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toContainText('48 new');
  const live = section(page, 'Live with Gmail');
  await expect(live.getByRole('group', { name: 'Live with Gmail' }).getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sync-line')).toHaveText('Live is off');

  await live.getByRole('group', { name: 'Live with Gmail' }).getByRole('button', { name: 'On' }).click();
  await expect(page.locator('.sync-line')).toHaveText('Live · starting');
  await live.getByRole('button', { name: 'Sync now' }).click(); // the first round only notes where Gmail is
  await expect(page.locator('.sync-line')).toContainText('Live · synced just now');

  // In Gmail: a new mail arrives.
  const one = app.gmail.messages[0];
  app.gmail.receive({ ...one, id: 'abc123def4567890', threadId: 'ffff000000000001', labels: ['Inbox'], sentAt: new Date().toISOString(), raw: one.raw.replace(/^Message-ID:.*$/m, 'Message-ID: <fresh@demo.example>').replace(/^Subject:.*$/m, 'Subject: Just arrived in Gmail') });
  await live.getByRole('button', { name: 'Sync now' }).click();
  await expect(section(page, 'In your database').getByRole('listitem').filter({ hasText: 'Just arrived in Gmail' })).toHaveCount(1);

  // Here: archive it through the app's own call (the Mail app of lesson 5 puts this on a key).
  const rows = await fetch(`${app.url}/api/mail/threads?q=${encodeURIComponent('Just arrived')}`).then((r) => r.json());
  const thread = await fetch(`${app.url}/api/mail/threads/${rows[0].id}`).then((r) => r.json());
  await post(app, `/api/mail/messages/${thread.messages.at(-1).id}/labels`, { remove: ['Inbox'] });
  await live.getByRole('button', { name: 'Sync now' }).click();
  await expect(live.locator('.outbox-row').first()).toContainText('Sent to Gmail');
  await expect(live.locator('.outbox-row').first()).toContainText('− Inbox');
  expect(app.gmail.sent.at(-1)).toMatchObject({ id: 'abc123def4567890', remove: ['Inbox'] });
  await expect(page.locator('.sync-line')).toContainText('Live · synced');
  await expect(page.locator('.sync-line')).not.toContainText('waiting');
});

test('with “Change your mail in Gmail” off a change only waits, and the page says what to switch on', async ({ page, app }, testInfo) => {
  const file = await liveSetup(app, testInfo, { modify: false });
  await page.goto(`${app.url}/mail/import`);
  await importFile(page, file, 'work@mypractice.com');
  await expect(page.getByRole('status').filter({ hasText: 'Imported:' })).toContainText('48 new');
  await page.getByRole('button', { name: 'Sync now' }).click();
  const rows = await fetch(`${app.url}/api/mail/threads?q=invoice`).then((r) => r.json());
  const thread = await fetch(`${app.url}/api/mail/threads/${rows[0].id}`).then((r) => r.json());
  await post(app, `/api/mail/messages/${thread.messages.at(-1).id}/labels`, { remove: ['Starred'] });
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(section(page, 'Live with Gmail').locator('.outbox-row').first()).toContainText('Waiting');
  await expect(page.locator('.sync-line')).toContainText('1 change waiting');
  expect(app.gmail.seen.filter((c) => c.method === 'POST').length).toBe(0);
});

test('Settings › Google has a third switch, Change your mail in Gmail, off; and the Library shows the Outbox row', async ({ page, app }, testInfo) => {
  await withGmail(app, testInfo, { newest: 0 });
  await page.goto(`${app.url}/settings`);
  const row = page.locator('.google-account [data-permission="mail.modify"]');
  await expect(row).toContainText('Change your mail in Gmail');
  await expect(row.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Outbox row', level: 2 })).toBeVisible();
  await expect(page.locator('.outbox-row:not(.is-mail) .outbox-state')).toHaveText(['Waiting', 'Sent to Gmail']);
});
