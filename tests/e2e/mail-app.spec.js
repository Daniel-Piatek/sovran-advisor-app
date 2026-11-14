// The Mail app (advanced/mail/5): one list, every account together or one at a time, six splits by rules you can read, a reader.
// The mailbox and the people are made up (scripts/demo-mail.js).
import { test, expect } from './fixtures.js';
import { makeMailbox } from '../../scripts/demo-mail.js';
const setMail = (app, on) => fetch(`${app.url}/api/modules`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'mail', on }) });

const post = (app, url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const upload = (app, account, filler) => fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account })}`, {
  method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': `${account}.mbox` }, body: Buffer.from(makeMailbox({ filler }).text),
});
const tab = (page, name) => page.getByRole('tablist', { name: 'Splits' }).getByRole('tab', { name: new RegExp(`^${name}`) });
const rows = (page) => page.getByRole('list', { name: 'Conversations' }).getByRole('listitem');

async function seed(app) {
  await post(app, '/api/people', { name: 'Lena Fischer', emails: 'lena@nordlicht.example' });
  await post(app, '/api/people', { name: 'Jonas Weber', emails: 'jonas@hafenkante.example' });
  expect((await upload(app, 'work@example.com', 0)).status).toBe(200);
}

test('the six splits, each with its count: Lena and Jonas Important, the invitation Calendar, the invoice Money, the digest Newsletters', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/mail`);
  await expect(page.getByRole('tablist', { name: 'Splits' }).getByRole('tab')).toHaveText([/Inbox/, /Drafts/, /Sent/, /Done/, /Important/, /Calendar/, /Money/, /Newsletters/, /Other/]); // Outbox only while something has not gone
  await expect(tab(page, 'Inbox')).toHaveAttribute('aria-selected', 'true'); // Mail opens on the Inbox
  await tab(page, 'Important').click();
  await expect(tab(page, 'Important')).toContainText('2');
  await expect(tab(page, 'Important')).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).locator('.mail-subject')).toHaveText(['Onboarding call on Thursday?', 'Brief for the launch event']); // newest first
  await tab(page, 'Calendar').click();
  await expect(rows(page).locator('.mail-subject')).toHaveText([/Gartenfest/]);
  await tab(page, 'Money').click();
  await expect(rows(page).locator('.mail-subject')).toHaveText(['Invoice 2026-114']);
  await tab(page, 'Newsletters').click();
  await expect(rows(page).locator('.mail-subject')).toHaveText(['This week: 5 ideas and a question']);
  await tab(page, 'Other').click();
  await expect(page.getByText('Nothing in Other.')).toBeVisible();
  await expect(page).toHaveURL(/split=other/);
});

test('Inbox is every incoming conversation, the five splits together, with its count; the tabs sit in two rows between a thin and a thick line', async ({ page, app, isMobile }) => {
  await seed(app);
  const { counts } = await (await fetch(`${app.url}/api/mail/inbox?split=inbox`)).json();
  const five = counts.important + counts.calendar + counts.money + counts.news + counts.other;
  expect(counts.inbox).toBe(five);
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${app.url}/mail`);
  await expect(tab(page, 'Inbox')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Inbox')).toContainText(String(five));
  await expect(rows(page)).toHaveCount(five);
  await expect(rows(page).locator('.mail-subject')).toContainText(['Onboarding call on Thursday?', 'Invoice 2026-114']);
  // Row 1 is Inbox · Drafts · Sent · (Outbox) · Done, row 2 the five splits; each row on one line, the second below the first;
  // nothing scrolls sideways.
  const layout = () => page.locator('.mail-splits').evaluate((box) => {
    const [views, filters] = box.querySelectorAll('.mail-splits-row');
    const lines = (row) => new Set([...row.children].map((c) => Math.round(c.getBoundingClientRect().top))).size;
    const s = getComputedStyle(box);
    return {
      views: [...views.children].map((c) => c.dataset.split), filters: [...filters.children].map((c) => c.dataset.split),
      viewLines: lines(views), filterLines: lines(filters), below: filters.getBoundingClientRect().top >= views.getBoundingClientRect().bottom,
      scrolls: box.scrollWidth > box.clientWidth || views.scrollWidth > views.clientWidth || filters.scrollWidth > filters.clientWidth,
      thin: [getComputedStyle(views).borderBottomWidth, getComputedStyle(views).borderBottomColor],
      thick: [s.borderBottomWidth, s.borderBottomColor], text: getComputedStyle(document.body).color,
    };
  });
  const got = await layout();
  expect(got.views).toEqual(['inbox', 'drafts', 'sent', 'done']);
  expect(got.filters).toEqual(['important', 'calendar', 'money', 'news', 'other']);
  expect(got).toMatchObject({ viewLines: 1, filterLines: 1, below: true, scrolls: false });
  // The thin line is the usual grey line; the thick one is twice as wide, in the text colour (Charcoal).
  expect(got.thin[0]).toBe('1px');
  expect(got.thick).toEqual(['2px', got.text]);
  expect(got.thin[1]).not.toBe(got.text);
  if (!isMobile) {
    await page.getByRole('separator', { name: 'Width of the list' }).focus();
    await page.keyboard.press('Home'); // the narrowest list, 280 px: the second row may wrap, but nothing scrolls sideways
    await expect(page.getByRole('separator', { name: 'Width of the list' })).toHaveAttribute('aria-valuenow', '280');
    expect(await layout()).toMatchObject({ viewLines: 1, below: true, scrolls: false });
    await tab(page, 'Other').click();
    await expect(tab(page, 'Other')).toHaveAttribute('aria-selected', 'true');
  }
});

test.describe('a server running older code than the page', () => {
  test.use({ expectedConsoleErrors: [/400/] });
  test('Mail says what the server answered and to restart the app, not that it is not running', async ({ page, app }) => {
    await seed(app);
    // What an app updated while its server kept running older code answers for a split it does not know yet.
    await page.route('**/api/mail/inbox?*', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'split is important, calendar, money, news, other, done.' }) }));
    await page.goto(`${app.url}/mail`);
    await expect(page.getByText(/Mail couldn't be loaded: split is important.*If the app was just updated, restart it\./)).toBeVisible();
    await expect(page.getByText('Is the app still running?')).toHaveCount(0);
  });
});

test('open the invoice: the line above it names its rule; the text is plain, and the attachment opens', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/mail?split=money`);
  await rows(page).first().click();
  await expect(page.locator('.mail-rule')).toHaveText('Money: the subject says invoice, receipt or payment.');
  await expect(page.locator('.mail-reader-subject')).toHaveText('Invoice 2026-114');
  await expect(page.locator('.mail-message .mail-text')).toContainText('Your invoice 2026-114 for 120.00 EUR is attached');
  const link = page.locator('.mail-attachments a');
  await expect(link).toHaveText('invoice-2026-114.pdf');
  expect((await fetch(app.url + await link.getAttribute('href'))).status).toBe(200);
  await expect(page).toHaveURL(/thread=/);

  await page.goto(`${app.url}/mail?split=important`); // (on a phone the list is behind the open conversation)
  await rows(page).filter({ hasText: 'Onboarding call' }).click();
  await expect(page.locator('.mail-rule')).toContainText('Important: from Lena Fischer, who is in your People, and it is not a bulk mail.');
  await expect(page.locator('.mail-message')).toHaveCount(3);
});

test('an account switch: all together, or one at a time, each row with its account’s letter', async ({ page, app }) => {
  await seed(app);
  expect((await upload(app, 'private@example.com', 0)).status).toBe(200); // the same made-up mail, in a second account
  await page.goto(`${app.url}/mail?split=important`);
  const accounts = page.getByRole('group', { name: 'Account' });
  await expect(accounts.getByRole('button')).toHaveText(['All accounts', /work@example.com/, /private@example.com/]);
  await expect(rows(page)).toHaveCount(4);
  await expect(tab(page, 'Important')).toContainText('4');
  await accounts.getByRole('button', { name: /private@example.com/ }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).locator('.mail-letter')).toHaveText(['P', 'P']);
  await expect(page).toHaveURL(/account=/);
  await expect(tab(page, 'Important')).toContainText('2');
  await accounts.getByRole('button', { name: 'All accounts' }).click();
  await expect(rows(page)).toHaveCount(4);
  expect((await rows(page).locator('.mail-letter').allTextContents()).sort()).toEqual(['P', 'P', 'W', 'W']);
});

test('with one account there is no switch; Done holds what is not in the Inbox any more', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/mail`);
  await expect(page.getByRole('group', { name: 'Account' })).toBeHidden();
  await tab(page, 'Done').click();
  await expect(page.getByText('Nothing in Done.')).toBeVisible();
});

test('on a phone the list first, then the conversation full width with a way back', async ({ page, app, isMobile }) => {
  test.skip(!isMobile, 'a phone layout');
  await seed(app);
  await page.goto(`${app.url}/mail?split=money`);
  await expect(page.locator('.mail-reader')).toBeHidden();
  await rows(page).first().click();
  await expect(page.locator('.mail-reader')).toBeVisible();
  await expect(rows(page)).toHaveCount(0); // the list is behind it
  await page.getByRole('link', { name: 'Mail' }).filter({ has: page.locator('svg') }).click();
  await expect(rows(page)).toHaveCount(1);
});

test('with Mail switched off the app says so, and the Library shows the Split tabs', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Split tabs', level: 2 })).toBeVisible();
  await expect(page.locator('.mail-splits .tab')).toHaveText([/Inbox/, /Drafts/, /Sent/, /Outbox/, /Done/, /Important/, /Calendar/, /Money/, /Newsletters/, /Other/]);
  await setMail(app, false); // Mail has no row in Settings › Modules yet (modules.js, hidden): it is switched behind the scenes
  await page.goto(`${app.url}/mail`);
  await expect(page.getByText('Mail is switched off.')).toBeVisible();
});

// ---- Mail 6: the keys, each measured under 50 ms ----

const focusBody = (page) => page.locator('body').click({ position: { x: 5, y: 5 } });
const openThread = (page) => page.locator('.mail-reader-subject');

test('j and k move, e marks done (the row leaves at once, the outbox follows, Undo brings it back)', async ({ page, app, isMobile }) => {
  await seed(app);
  await page.goto(`${app.url}/mail?split=important`);
  if (!isMobile) await expect(rows(page)).toHaveCount(2); // (on a phone the list is behind the open conversation)
  await focusBody(page);
  await page.keyboard.press('j');
  await expect(openThread(page)).toHaveText('Onboarding call on Thursday?');
  await page.keyboard.press('j');
  await expect(openThread(page)).toHaveText('Brief for the launch event');
  await page.keyboard.press('k');
  await expect(openThread(page)).toHaveText('Onboarding call on Thursday?');

  await page.keyboard.press('e');
  await expect(openThread(page)).toHaveText('Brief for the launch event'); // the next one opened in the same moment
  await expect(page.locator('.undo-bar')).toContainText('is Done');
  if (!isMobile) {
    await expect(rows(page)).toHaveCount(1);
    await expect(tab(page, 'Important')).toContainText('1');
    await expect(tab(page, 'Done')).toContainText('1');
  }
  // the work behind it: one change waiting for Gmail for each mail that was in the Inbox
  await expect.poll(async () => (await fetch(`${app.url}/api/mail/outbox`).then((r) => r.json())).length).toBeGreaterThan(0);
  const waiting = await fetch(`${app.url}/api/mail/outbox`).then((r) => r.json());
  expect(waiting.every((o) => o.remove.includes('Inbox') && o.state === 'waiting')).toBe(true);

  await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await fetch(`${app.url}/api/mail/inbox?split=important`).then((r) => r.json())).counts.important).toBe(2);
});

test('# and the trash button delete: the row leaves at once, Done does not grow, it is gone from search, Undo brings it back', async ({ page, app, isMobile }) => {
  await seed(app);
  const doneBefore = (await fetch(`${app.url}/api/mail/inbox?split=done`).then((r) => r.json())).counts.done;
  await page.goto(`${app.url}/mail?split=important`);
  if (!isMobile) await expect(rows(page)).toHaveCount(2);
  await focusBody(page);
  await page.keyboard.press('j');
  await expect(openThread(page)).toHaveText('Onboarding call on Thursday?');
  await page.keyboard.press('#');
  await expect(openThread(page)).toHaveText('Brief for the launch event'); // the next one opened in the same moment
  await expect(page.locator('.undo-bar')).toContainText('is Deleted');
  if (!isMobile) {
    await expect(rows(page)).toHaveCount(1);
    await expect(tab(page, 'Important')).toContainText('1');
  }
  await expect.poll(async () => (await fetch(`${app.url}/api/mail/inbox?split=done`).then((r) => r.json())).counts.done).toBe(doneBefore);
  const found = await fetch(`${app.url}/api/mail/threads?q=Onboarding`).then((r) => r.json());
  expect(found).toHaveLength(0);
  await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await fetch(`${app.url}/api/mail/inbox?split=important`).then((r) => r.json())).counts.important).toBe(2);

  // the quiet trash button on the open conversation does the same, with no question first
  await page.goto(`${app.url}/mail?split=important`);
  await focusBody(page);
  await page.keyboard.press('j');
  await expect(openThread(page)).toHaveText('Onboarding call on Thursday?');
  await page.locator('.mail-reader').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.undo-bar')).toContainText('is Deleted');
  await expect.poll(async () => (await fetch(`${app.url}/api/mail/inbox?split=important`).then((r) => r.json())).counts.important).toBe(1);
});

test('h opens Remind me: later today, tomorrow, next week; a choice makes a task with a reminder', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/mail?split=important`);
  await focusBody(page);
  await page.keyboard.press('j');
  await page.keyboard.press('h');
  const menu = page.getByRole('menu', { name: 'Remind me' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([/Later today|Tomorrow/, /Tomorrow|Next week/, /Next week|Not now/].slice(0, (await menu.getByRole('menuitem').count())));
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.keyboard.press('h');
  await page.getByRole('menuitem', { name: /Tomorrow/ }).click();
  await expect(page.locator('.undo-bar')).toContainText('Reminder set: Tomorrow');
  const [task] = await fetch(`${app.url}/api/tasks`).then((r) => r.json());
  expect(task.text).toBe('Reply: Onboarding call on Thursday?');
  expect(task.reminder.at.slice(11)).toBe('09:00');
});

test('Cmd K in Mail lists every Mail command with its key; elsewhere it is still quick capture; ? shows the times', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/mail?split=important`);
  await focusBody(page);
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Mail commands' });
  await expect(palette).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Capture' })).toHaveCount(0);
  const options = palette.getByRole('option');
  await expect(options.filter({ hasText: 'Done: out of the Inbox' }).locator('kbd')).toHaveText('e');
  await expect(options.filter({ hasText: 'Reply' }).locator('kbd')).toHaveText('r');
  await palette.getByLabel('Type a command').fill('money');
  await expect(options).toHaveText([/Go to Money/]);
  await page.keyboard.press('Enter');
  await expect(tab(page, 'Money')).toHaveAttribute('aria-selected', 'true');

  await focusBody(page);
  await page.keyboard.press('?');
  const panel = page.getByRole('dialog', { name: 'Keys and their times' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('tr[data-key="done"] .mail-time')).toHaveText('not pressed yet');
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await page.keyboard.press('?');
  await expect(panel.locator('tr[data-key="next"] .mail-time')).toHaveText(/^\d+(\.\d)? ms$/);
  await page.keyboard.press('Escape');

  await page.goto(`${app.url}/notes`);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible();
});

test('the keys do nothing while typing in a field', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/mail?split=important`);
  await expect(rows(page).first()).toBeVisible(); // the mail's keys work once its list is drawn
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByLabel('Type a command').fill('jjeh?');
  await expect(page.getByLabel('Type a command')).toHaveValue('jjeh?');
  await expect(page.getByRole('menu', { name: 'Remind me' })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
});

test('every key stays under 50 ms on a list of a thousand conversations', async ({ page, app }) => {
  test.setTimeout(120_000);
  await seed(app);
  expect((await upload(app, 'big@example.com', 3000)).status).toBe(200); // ~1,000 conversations
  await page.goto(`${app.url}/mail?split=other`);
  await expect(rows(page).first()).toBeVisible();
  await focusBody(page);
  const total = await page.getByRole('tablist', { name: 'Splits' }).locator('.tab-count').allTextContents();
  expect(total.map(Number).reduce((a, b) => a + b, 0)).toBeGreaterThan(900);
  for (let i = 0; i < 6; i++) { await page.keyboard.press('j'); await page.waitForTimeout(40); }
  for (let i = 0; i < 3; i++) { await page.keyboard.press('k'); await page.waitForTimeout(40); }
  for (let i = 0; i < 4; i++) { await page.keyboard.press('e'); await page.waitForTimeout(150); }
  await page.keyboard.press('h');
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  const ms = await page.locator('.mail-times-table tr[data-key]').evaluateAll((trs) => trs.map((tr) => [tr.dataset.key, tr.querySelector('.mail-time').textContent]));
  const timed = ms.filter(([, t]) => /ms$/.test(t));
  expect(timed.map(([k]) => k).sort()).toEqual(['done', 'next', 'previous', 'remind']);
  for (const [key, t] of timed) expect(parseFloat(t), `${key} took ${t}`).toBeLessThan(50);
  // the worst single press, too, not only the typical one
  expect(Number(await page.evaluate(() => document.getElementById('app')?.dataset.lastKeyMs ?? '0'))).toBeLessThan(50);
});

test('the Library shows the Key hint', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Key hint', level: 2 })).toBeVisible();
  await expect(page.locator('.lib-row .key-hint kbd')).toHaveText(['e', 'Cmd K']);
});

// ---- Mail 7: a sealed frame for every mail ----

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const openDigest = async (page, app) => {
  await page.goto(`${app.url}/mail?split=news`);
  await rows(page).filter({ hasText: 'This week' }).click();
  await expect(page.locator('.sealed-frame')).toBeVisible();
  await expect(page.locator('.mail-rule')).toContainText('Newsletters');
};
const frameDoc = (page) => page.frameLocator('.sealed-frame');

test('the digest opens in a sealed frame: no script permission, images held back, nothing fetched, and the bar says so', async ({ page, app }) => {
  await seed(app);
  let fetched = 0;
  await page.route('https://images.newsletter.example/**', (route) => { fetched++; route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await openDigest(page, app);
  const sandbox = await page.locator('.sealed-frame').getAttribute('sandbox');
  expect(sandbox).not.toContain('allow-scripts');
  expect(sandbox).not.toContain('allow-top-navigation');
  await expect(frameDoc(page).locator('h1')).toHaveText('Five ideas');
  await expect(page.locator('.mail-images-bar')).toContainText('2 images were held back: nothing was fetched from images.newsletter.example.');
  await page.waitForTimeout(500);
  expect(fetched).toBe(0);
  await expect(page.locator('.mail-images-bar').getByRole('button')).toHaveText('Load images from this sender');
  // the link that says one address and goes to another is marked under the mail
  await expect(page.locator('.mail-link-marks li')).toHaveText(/“Read it on deepwork.news” says deepwork.news but goes to click.mailer-track.io./);
});

test('Load images from this sender: they load, it is remembered for that sender only', async ({ page, app }) => {
  await seed(app);
  let fetched = 0;
  await page.route('https://images.newsletter.example/**', (route) => { fetched++; route.fulfill({ status: 200, contentType: 'image/png', body: PNG }); });
  await openDigest(page, app);
  await page.getByRole('button', { name: 'Load images from this sender' }).click();
  await expect(page.locator('.mail-images-bar')).toContainText('Images from digest@newsletter.example load, and that is remembered for this sender.');
  await expect.poll(() => fetched).toBeGreaterThanOrEqual(2);
  expect(await (await fetch(`${app.url}/api/mail/senders`)).json()).toEqual([{ email: 'digest@newsletter.example', load_images: true }]);

  fetched = 0;
  await openDigest(page, app); // another visit: remembered
  await expect(page.locator('.mail-images-bar')).toContainText('load, and that is remembered');
  await expect.poll(() => fetched).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Stop loading images' }).click();
  await expect(page.locator('.mail-images-bar')).toContainText('held back');
  expect(await (await fetch(`${app.url}/api/mail/senders`)).json()).toEqual([{ email: 'digest@newsletter.example', load_images: false }]);
});

test('a script in a mail never runs, and a link opens in a new tab only when pressed, never inside the frame', async ({ page, app, context }) => {
  const evil = makeMailbox({ filler: 0 }).text + '\nFrom 1700000000000000999@xxx Mon Nov 09 12:00:00 +0000 2026\nX-GM-THRID: 1700000000000009999\nX-Gmail-Labels: Inbox\nMessage-ID: <evil@x.example>\nDate: Mon, 09 Nov 2026 12:00:00 +0000\nFrom: Pat <pat@promo.example>\nTo: demo@example.com\nSubject: Win a prize\nList-Unsubscribe: <https://promo.example/u>\nMIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n<p id="p">Hello</p><script>document.getElementById("p").textContent="SCRIPT RAN";window.top.document.title="HACKED"</script><a href="https://click.promo.example/go">Open it</a><img src="https://tracker.example/pixel.gif">\n';
  expect((await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: 'work@example.com' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'e.mbox' }, body: Buffer.from(evil) })).status).toBe(200);
  let tracked = 0;
  await page.route('https://tracker.example/**', (route) => { tracked++; route.fulfill({ status: 200, body: '' }); });
  await context.route('https://click.promo.example/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>landed</p>' }));
  await page.goto(`${app.url}/mail?split=news`);
  await rows(page).filter({ hasText: 'Win a prize' }).click();
  await expect(frameDoc(page).locator('#p')).toHaveText('Hello');
  await page.waitForTimeout(400);
  await expect(frameDoc(page).locator('#p')).toHaveText('Hello'); // the script did not run
  expect(await page.title()).not.toBe('HACKED');
  expect(tracked).toBe(0);
  const url = page.url();
  const popup = page.waitForEvent('popup');
  await frameDoc(page).getByRole('link', { name: 'Open it' }).click();
  expect((await popup).url()).toBe('https://click.promo.example/go');
  expect(page.url()).toBe(url); // the app did not move
  await expect(frameDoc(page).locator('#p')).toHaveText('Hello'); // nor did the frame
});

test('a mail with only text is shown as plain text, in no frame; one with html is framed', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/mail?split=important`);
  await rows(page).filter({ hasText: 'Onboarding call' }).click();
  await expect(page.locator('.mail-message')).toHaveCount(3);
  await expect(page.locator('.mail-text')).toHaveCount(2); // the two written as text
  await expect(page.locator('.sealed-frame')).toHaveCount(1); // Lena's, which came with html
  await expect(page.frameLocator('.sealed-frame').locator('p').first()).toContainText('Thursday works.');
});

test('the Library shows the Sealed frame', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Sealed frame', level: 2 })).toBeVisible();
  await expect(page.frameLocator('.lib-sealed .sealed-frame').locator('h3')).toHaveText('Five ideas');
});

// ---- Mail 8: write, undo, send later (Google and Gmail are stood in for; nothing real is sent) ----
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';

async function writer(app, { send = false } = {}) {
  const follow = async (connected) => { const toGoogle = await fetch(connected.url, { redirect: 'manual' }); await fetch(toGoogle.headers.get('location'), { redirect: 'manual' }); };
  const j = (url, method, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  await j('/api/google/client', 'PUT', { client_id: FAKE_CLIENT_ID, client_secret: FAKE_CLIENT_SECRET });
  await follow(await j('/api/google/connect', 'POST', {}));
  const [account] = (await fetch(`${app.url}/api/google`).then((r) => r.json())).accounts;
  await follow(await j(`/api/google/accounts/${account.id}`, 'PATCH', { permission: 'mail.read', on: true }));
  if (send) await follow(await j(`/api/google/accounts/${account.id}`, 'PATCH', { permission: 'mail.send', on: true }));
  await post(app, '/api/people', { name: 'Lena Fischer', emails: 'lena@nordlicht.example' });
  const text = makeMailbox({ filler: 0 }).text.replaceAll('demo@example.com', 'work@mypractice.com');
  expect((await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: 'work@mypractice.com' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'w.mbox' }, body: Buffer.from(text) })).status).toBe(200);
}
const composerOf = (page) => page.getByRole('form', { name: 'Write a mail' });
const openLena = async (page, app) => {
  await page.goto(`${app.url}/mail?split=important`);
  await rows(page).filter({ hasText: 'Onboarding call' }).click();
  await expect(page.locator('.mail-message')).toHaveCount(3);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
};

test('r opens the composer under the conversation, to and subject set; Send waits ten seconds, Undo gives the words back', async ({ page, app }) => {
  await writer(app, { send: true });
  await page.goto(`${app.url}/mail?split=important`);
  await rows(page).filter({ hasText: 'Onboarding call' }).click();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('r');
  const form = composerOf(page);
  await expect(form).toBeVisible();
  await expect(form.getByLabel('To')).toHaveValue('lena@nordlicht.example');
  await expect(form.getByLabel('Subject')).toHaveValue('Re: Onboarding call on Thursday?');
  await expect(form.getByLabel('Your answer')).toBeFocused();
  await page.keyboard.type('See you at 10.');
  await form.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composerOf(page)).toHaveCount(0);
  await expect(page.locator('.mail-sending')).toContainText(/Sending in \d+ s/);
  expect(app.gmail.outgoing.length).toBe(0);
  await page.locator('.mail-sending').getByRole('button', { name: 'Undo' }).click();
  await expect(composerOf(page).getByLabel('Your answer')).toHaveValue(/^See you at 10\./); // the words are back (the quote under them)
  expect((await fetch(`${app.url}/api/mail/sends`).then((r) => r.json()))[0].state).toBe('undone');
  expect(app.gmail.outgoing.length).toBe(0);
  await page.keyboard.press('Escape');
  await expect(composerOf(page)).toHaveCount(0);
});

test('the ten seconds pass and it goes, in the conversation’s own thread, once', async ({ page, app }) => {
  test.setTimeout(60_000);
  await writer(app, { send: true });
  await openLena(page, app);
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Your answer')).toBeFocused();
  await page.keyboard.type('Ready when you are.');
  await composerOf(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.mail-sending')).toHaveText('Sent.', { timeout: 25_000 });
  expect(app.gmail.outgoing.length).toBe(1);
  expect(app.gmail.outgoing[0].threadId).toBeTruthy();
  expect(app.gmail.outgoing[0].raw).toMatch(/^In-Reply-To: <.+>$/m);
  await page.waitForTimeout(3000);
  expect(app.gmail.outgoing.length).toBe(1);
});

test('Send later waits for tomorrow at 08:00, with Undo; "Remind me if no answer" is kept with it', async ({ page, app }) => {
  await writer(app, { send: true });
  await openLena(page, app);
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Your answer')).toBeFocused();
  await page.keyboard.type('Tomorrow, then.');
  await composerOf(page).getByLabel('Remind me if no answer in 3 days').check();
  await composerOf(page).getByRole('button', { name: /Send later/ }).click();
  await expect(page.locator('.mail-sending')).toHaveText(/Waits for tomorrow at 08:00/);
  const [row] = await fetch(`${app.url}/api/mail/sends`).then((r) => r.json());
  expect([row.state, row.remind_days]).toEqual(['waiting', 3]);
  expect(app.gmail.outgoing.length).toBe(0);
  await page.locator('.mail-sending').getByRole('button', { name: 'Undo' }).click();
  expect((await fetch(`${app.url}/api/mail/sends`).then((r) => r.json()))[0].state).toBe('undone');
});

test('the first send asks Google for the one permission, then the words are back and it goes on', async ({ page, app }) => {
  await writer(app, { send: false });
  await openLena(page, app);
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Your answer')).toBeFocused();
  await page.keyboard.type('A first answer.');
  const form = composerOf(page);
  await expect(form.locator('.mail-allow')).toContainText('Sending needs your OK for “Send mail as you”');
  await expect(form.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Allow sending' }).click();
  await expect(page).toHaveURL(/\/mail\?/); // Google answered at once (the stand-in) and sent the browser back
  await expect(composerOf(page).getByLabel('Your answer')).toHaveValue(/^A first answer\.\n\nOn .+ wrote:/); // the quote of her mail stays under it
  await expect(composerOf(page).getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  const [account] = (await fetch(`${app.url}/api/google`).then((r) => r.json())).accounts;
  expect(account.permissions.find((p) => p.id === 'mail.send').on).toBe(true);
  expect(account.permissions.find((p) => p.id === 'mail.modify').on).toBe(false);
});

test('New email (the button, c or Cmd K) writes a mail with no conversation: To with People’s addresses, Cc, Subject; it waits ten seconds and goes as a new thread', async ({ page, app }) => {
  test.setTimeout(60_000);
  await writer(app, { send: true });
  await page.goto(`${app.url}/mail`);
  const button = page.getByRole('button', { name: 'New email' });
  await expect(button).toHaveClass(/button-primary/); // the screen's one accent
  await button.click();
  const form = composerOf(page);
  await expect(form.getByLabel('To')).toBeFocused();
  await expect(form.getByRole('button', { name: 'Send', exact: true })).not.toHaveClass(/button-primary/);
  await expect(form.locator('datalist option[value="lena@nordlicht.example"]')).toHaveCount(1); // suggested from People
  await form.getByLabel('To').fill('lena@nordlicht.example');
  await form.getByLabel('Cc').fill('jonas@hafenkante.example');
  await form.getByLabel('Subject').fill('A new idea');
  await form.getByLabel('Your mail').click();
  await page.keyboard.type('Just kidding, every key here is mine: j k e d c r t.'); // Mail's keys never fire while typing
  await expect(form.getByLabel('Your mail')).toHaveValue('Just kidding, every key here is mine: j k e d c r t.');
  await expect(page.locator('.undo-bar')).toHaveCount(0); // nothing was made Done or Deleted
  await form.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(composerOf(page)).toHaveCount(0);
  await expect(page.locator('.mail-sending')).toContainText(/Sending in \d+ s/);
  expect(app.gmail.outgoing.length).toBe(0);
  await page.locator('.mail-sending').getByRole('button', { name: 'Undo' }).click();
  await expect(composerOf(page).getByLabel('Subject')).toHaveValue('A new idea'); // the words are back, still a new mail
  await expect(composerOf(page).getByLabel('Cc')).toHaveValue('jonas@hafenkante.example');
  await composerOf(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.mail-sending')).toHaveText('Sent.', { timeout: 25_000 });
  expect(app.gmail.outgoing.length).toBe(1);
  expect(app.gmail.outgoing[0].threadId).toBeFalsy();
  expect(app.gmail.outgoing[0].raw).toMatch(/^Cc: jonas@hafenkante\.example/m);
  expect(app.gmail.outgoing[0].raw).not.toMatch(/^In-Reply-To:/m);

  // c and Cmd K open it too, and Discard (or Escape) closes an empty one
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('c');
  await expect(composerOf(page).getByLabel('To')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(composerOf(page)).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('textbox', { name: 'Type a command' }).fill('new email');
  await page.keyboard.press('Enter');
  await expect(composerOf(page)).toBeVisible();
  await composerOf(page).getByRole('button', { name: 'Discard' }).click();
  await expect(composerOf(page)).toHaveCount(0);
});

test('New email without “Send mail as you” says so plainly and asks Google; the words come back', async ({ page, app }) => {
  await writer(app, { send: false });
  await page.goto(`${app.url}/mail`);
  await page.getByRole('button', { name: 'New email' }).click();
  const form = composerOf(page);
  await expect(form.locator('.mail-allow')).toContainText('Sending needs your OK for “Send mail as you”');
  await expect(form.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await form.getByLabel('To').fill('lena@nordlicht.example');
  await form.getByLabel('Subject').fill('Hello');
  await form.getByRole('button', { name: 'Allow sending' }).click();
  await expect(page).toHaveURL(/\/mail\?/);
  await expect(composerOf(page).getByLabel('Subject')).toHaveValue('Hello');
  await expect(composerOf(page).getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

test('a new mail with words is not lost by opening a conversation', async ({ page, app }) => {
  await seed(app);
  await page.goto(`${app.url}/mail?split=important`);
  await expect(rows(page).first()).toBeVisible(); // the mail's keys work once its list is drawn
  await page.keyboard.press('c');
  await composerOf(page).getByLabel('Subject').fill('Keep me');
  if (await rows(page).first().isVisible()) await rows(page).first().click(); // (on a phone the list is behind the new mail)
  await expect(composerOf(page).getByLabel('Subject')).toHaveValue('Keep me');
});

test('the divider between the list and the conversation: drag it or use the arrows; the width is kept after a reload', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'a phone keeps the list and the conversation one under the other');
  await seed(app);
  await page.goto(`${app.url}/mail?split=important`);
  const divider = page.getByRole('separator', { name: 'Width of the list' });
  const list = page.locator('.mail-list-panel');
  const reader = page.locator('.mail-reader-col');
  const before = (await list.boundingBox()).width;
  const readerBefore = (await reader.boundingBox()).width;
  const box = await divider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = (await list.boundingBox()).width;
  expect(Math.round(after - before)).toBe(120);
  expect(Math.round(readerBefore - (await reader.boundingBox()).width)).toBe(120);
  await page.reload();
  await expect(rows(page).first()).toBeVisible();
  expect(Math.round((await list.boundingBox()).width)).toBe(Math.round(after));
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', String(Math.round(after) - 16));
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '280'); // never narrower
  await page.mouse.move(box.x + 5, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 2000, box.y + 50, { steps: 3 });
  await page.mouse.up();
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(720); // never wider
  await expect(rows(page)).toHaveCount(2); // a drag never opens or moves a conversation
});

test('the top bar: Mail, New email level with the conversation’s panel, Import and sync on the right', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'a large-screen layout');
  await seed(app);
  await page.goto(`${app.url}/mail`);
  const add = await page.getByRole('button', { name: 'New email' }).boundingBox();
  const reader = await page.locator('.mail-reader-col').boundingBox();
  expect(Math.abs(add.x - reader.x)).toBeLessThanOrEqual(2);
  const bar = await page.locator('.top-bar').boundingBox();
  const link = await page.getByRole('link', { name: 'Import and sync' }).boundingBox();
  expect(Math.abs(bar.x + bar.width - (link.x + link.width))).toBeLessThan(32);
});

test('the Library shows the Mail composer', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Mail composer', level: 2 })).toBeVisible();
  await expect(page.locator('.lib-composer').getByLabel('To')).toHaveValue('lena@nordlicht.example');
});

// ---- Mail 9: read confirmations: Opened, never Read ----

test('the switch is off, and without a public address it is disabled and says why; with one it is there, off', async ({ page, app }) => {
  await writer(app, { send: true });
  await openLena(page, app);
  await page.keyboard.press('r');
  const form = composerOf(page);
  await expect(form.getByLabel('Read confirmation')).toBeDisabled();
  await expect(form.getByLabel('Read confirmation')).not.toBeChecked();
  await expect(form).toContainText('needs a public address for its picture');
  await page.keyboard.press('Escape');

  await page.goto(`${app.url}/mail/import`);
  const part = page.getByRole('region', { name: 'Read confirmations', exact: true });
  await expect(part).toContainText('Opened');
  await expect(part).toContainText('never “Read”');
  await part.getByLabel('Public address of this app').fill('ftp://nope');
  await part.getByRole('button', { name: 'Save the address' }).click();
  await expect(part.getByRole('alert')).toContainText('Give the address as https://');
  await part.getByLabel('Public address of this app').fill(app.url);
  await part.getByRole('button', { name: 'Save the address' }).click();
  await expect(part.locator('code')).toHaveText(`${app.url}/o/<token>.gif`);

  await openLena(page, app);
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Read confirmation')).toBeEnabled();
  await expect(composerOf(page).getByLabel('Read confirmation')).not.toBeChecked();
});

test('switched on for one mail: it carries the picture; an open shows “Opened · today …”, a scanner is listed and not counted; it is remembered for her', async ({ page, app }) => {
  test.setTimeout(60_000);
  await writer(app, { send: true });
  await fetch(`${app.url}/api/mail/pixel-base`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: app.url }) });
  await openLena(page, app);
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Your answer')).toBeFocused();
  await page.keyboard.type('Ready when you are.');
  await composerOf(page).getByLabel('Read confirmation').check();
  await composerOf(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.mail-sending')).toHaveText('Sent.', { timeout: 25_000 });
  const raw = app.gmail.outgoing[0].raw;
  const pixel = /<img src=3D"?([^" ]+)|src="([^"]+\.gif)"/.exec(Buffer.from(raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').match(/text\/html[^]*?\r\n\r\n([A-Za-z0-9+/=\r\n]+)/)[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));
  const url = pixel[1] ?? pixel[2];
  expect(url).toMatch(new RegExp(`^${app.url.replace(/[.]/g, '\\.')}/o/`));

  // a scanner and a fetch right after sending, then (after the thirty seconds) a person
  await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Proofpoint' } });
  await page.reload();
  await expect(page.locator('.confirm-chip')).toHaveText('Not opened yet');
  await expect(page.locator('.confirm-skipped')).toContainText('Not counted: a mail scanner');
  await expect(page.locator('.confirm-chip')).not.toContainText('Read');

  await new Promise((resolve) => setTimeout(resolve, 31_000));
  await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Safari' } });
  await page.reload();
  await expect(page.locator('.confirm-chip')).toContainText(/^\s*Opened · today \d\d:\d\d/);
  await expect(page.locator('.confirm-skipped')).toHaveCount(1);

  // remembered for her: the next composer has it on
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Read confirmation')).toBeChecked();
  expect((await fetch(`${app.url}/api/mail/confirmations`).then((r) => r.json())).people).toEqual([{ email: 'lena@nordlicht.example', confirm: true }]);
});

test('the Library shows the Opened chip, and never the word Read', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Opened chip', level: 2 })).toBeVisible();
  await expect(page.locator('.confirm-chip')).toHaveText([/Opened · today/, /Not opened yet/]);
  await expect(page.locator('.confirm-skipped')).toContainText('Not counted: a mail scanner');
  for (const chip of await page.locator('.confirm-chip').allTextContents()) expect(chip).not.toMatch(/\bRead\b/);
});

// ---- Mail 10: Mail meets People ----

test('beside an invoice from a stranger: not in People yet; Shift P adds them, marked From a mail', async ({ page, app }) => {
  expect((await upload(app, 'demo@example.com', 0)).status).toBe(200); // the made-up owner is this account
  await page.goto(`${app.url}/mail?split=money`);
  await rows(page).first().click();
  const card = page.locator('.mail-person[data-email="billing@printshop.example"]');
  await expect(card).toContainText('Not in People yet · billing@printshop.example');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+P');
  await expect(page.locator('.undo-bar')).toContainText('Billing is in People, from a mail.');
  await expect(card.getByRole('link', { name: /Billing/ })).toBeVisible();
  await expect(card).not.toContainText('Not in People yet');
  const people = await fetch(`${app.url}/api/people`).then((r) => r.json());
  const billing = people.find((p) => p.name === 'Billing');
  const full = await fetch(`${app.url}/api/people/${billing.id}`).then((r) => r.json());
  expect([full.emails, full.how_met]).toEqual(['billing@printshop.example', 'From a mail: Invoice 2026-114']);
  await page.keyboard.press('Shift+P'); // nobody left to add: nothing happens
  expect((await fetch(`${app.url}/api/people`).then((r) => r.json())).length).toBe(people.length);
});

test('Lena’s mail shows who she is and her company; a company’s own domain finds its card; her page lists the conversation and last in touch', async ({ page, app }) => {
  await post(app, '/api/companies', { name: 'Hafenkante', website: 'hafenkante.example' });
  const nord = await post(app, '/api/companies', { name: 'Nordlicht Studio', website: 'nordlicht.example' });
  const lena = await post(app, '/api/people', { name: 'Lena Fischer', role: 'Designer', company_id: nord.id, emails: 'lena@nordlicht.example' });
  expect((await upload(app, 'demo@example.com', 0)).status).toBe(200);
  await page.goto(`${app.url}/mail?split=important`);
  await rows(page).filter({ hasText: 'Onboarding call' }).click();
  const card = page.locator('.mail-person[data-email="lena@nordlicht.example"]');
  await expect(card.getByRole('link', { name: /Lena Fischer/ })).toContainText('Designer');
  await expect(card.getByRole('link', { name: 'Nordlicht Studio' })).toBeVisible();
  // Jonas is not a person, but the company whose domain it is has a card beside the brief
  const brief = await fetch(`${app.url}/api/mail/threads?q=brief`).then((r) => r.json());
  await page.goto(`${app.url}/mail?thread=${brief[0].id}`);
  await expect(page.locator('.mail-person[data-email="jonas@hafenkante.example"]').getByRole('link', { name: 'Hafenkante' })).toBeVisible();

  await page.goto(`${app.url}/people/${lena.id}`);
  const section = page.getByRole('region', { name: 'Mail with Lena Fischer' });
  await expect(section.locator('.mail-subject')).toHaveText(['Onboarding call on Thursday?']);
  await expect(section.locator('.last-touch-chip')).toHaveText(/^Last in touch: .+/);
  await section.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/mail\?(split=\w+&)?thread=/);
  await expect(page.locator('.mail-reader-subject')).toHaveText('Onboarding call on Thursday?');
  await expect(page.locator('.mail-message')).toHaveCount(3);
});

test('with Mail switched off the section leaves a person’s page, and the people stay', async ({ page, app }) => {
  const lena = await post(app, '/api/people', { name: 'Lena Fischer', emails: 'lena@nordlicht.example' });
  await setMail(app, false); // Mail has no row in Settings › Modules yet (modules.js, hidden): it is switched behind the scenes
  await page.goto(`${app.url}/people/${lena.id}`);
  await expect(page.getByRole('heading', { name: 'Notes', level: 2 })).toBeVisible();
  await expect(page.getByRole('region', { name: /Mail with/ })).toHaveCount(0);
});

// Sent and Outbox (2026-11-11): where what you wrote is, before and after it goes.
const outboxRows = (page) => page.locator('.outbox-row.is-mail:not(.is-draft)');
const draftRows = (page) => page.locator('.outbox-row.is-draft');
// On a phone the open conversation covers the list: back to it, as a person would.
const backToList = async (page, isMobile) => { const back = page.locator('.mail-reader').getByRole('link', { name: 'Mail' }); if (isMobile && await back.isVisible()) await back.click(); };

test('Sent lists every conversation you wrote in, the latest you sent first; it opens; e there does not make it Done', async ({ page, app, isMobile }) => {
  await writer(app);
  await page.goto(`${app.url}/mail`);
  await expect(tab(page, 'Outbox')).toHaveCount(0);
  await tab(page, 'Sent').click();
  await expect(page).toHaveURL(/split=sent/);
  await expect(rows(page).locator('.mail-subject')).toHaveText(['Onboarding call on Thursday?', 'Brief for the launch event']);
  await expect(tab(page, 'Sent')).toContainText('2');
  await rows(page).first().click();
  await expect(page.locator('.mail-message')).toHaveCount(3);
  await expect(page.locator('.mail-rule')).toContainText('Important'); // where its Inbox mail is
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('e');
  await expect(page.locator('.undo-bar')).toContainText('Done takes a conversation out of the Inbox');
  await backToList(page, isMobile);
  await expect(rows(page)).toHaveCount(2);
});

test('a mail on its way is in the Outbox with Undo; when it has gone the Outbox goes and Sent has it first', async ({ page, app }) => {
  test.setTimeout(60_000);
  await writer(app, { send: true });
  await page.goto(`${app.url}/mail`);
  await page.getByRole('button', { name: 'New email' }).click();
  const form = composerOf(page);
  await form.getByLabel('To').fill('lena@nordlicht.example');
  await form.getByLabel('Subject').fill('Hello from here');
  await form.getByLabel('Your mail').fill('Short one.');
  await form.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(tab(page, 'Outbox')).toContainText('1');
  await tab(page, 'Outbox').click();
  await expect(outboxRows(page)).toHaveCount(1);
  await expect(outboxRows(page)).toContainText('To lena@nordlicht.example');
  await expect(outboxRows(page)).toContainText('Hello from here');
  await expect(outboxRows(page).locator('.outbox-state')).toHaveText(/Sending in \d+ s/);
  await outboxRows(page).getByRole('button', { name: 'Undo' }).click();
  await expect(composerOf(page).getByLabel('Subject')).toHaveValue('Hello from here'); // the words are back
  expect(app.gmail.outgoing.length).toBe(0);
  const countsNow = async () => (await fetch(`${app.url}/api/mail/inbox?split=outbox`).then((r) => r.json())).counts;
  const outboxCount = async () => (await countsNow()).outbox;
  expect(await outboxCount()).toBe(0);
  expect((await countsNow()).drafts).toBe(1); // taken back, it is a draft again
  await composerOf(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.mail-sending')).toHaveText('Sent.', { timeout: 25_000 });
  expect(app.gmail.outgoing.length).toBe(1);
  expect(await outboxCount()).toBe(0);
  await page.goto(`${app.url}/mail?split=important`);
  await expect(tab(page, 'Important')).toBeVisible();
  await expect(tab(page, 'Outbox')).toHaveCount(0); // nothing waits: no Outbox tab
  // The Live sync reads it back from Gmail (stood in for here by the fake Gmail's own copy, as a new thread with the Sent label).
  const sentRaw = app.gmail.outgoing[0].raw.replace(/\r\n/g, '\n');
  const mbox = `From work@mypractice.com Wed Nov 11 10:00:00 2026\nX-Gmail-Labels: Sent\n${sentRaw}\n`;
  expect((await fetch(`${app.url}/api/mail/import?${new URLSearchParams({ account: 'work@mypractice.com' })}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 's.mbox' }, body: Buffer.from(mbox) })).status).toBe(200);
  await page.goto(`${app.url}/mail?split=sent`);
  await expect(rows(page).first().locator('.mail-subject')).toHaveText('Hello from here');
});

test('Send later waits in the Outbox with its time; Send now sends it; a mail that failed says why and goes again only on Try again', async ({ page, app, isMobile }) => {
  test.setTimeout(60_000);
  await writer(app, { send: true });
  await openLena(page, app);
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Your answer')).toBeFocused();
  await page.keyboard.type('Tomorrow is fine.');
  await composerOf(page).getByRole('button', { name: /Send later/ }).click();
  await backToList(page, isMobile);
  await tab(page, 'Outbox').click();
  await expect(outboxRows(page).locator('.outbox-state')).toHaveText(/Waits until .* 08:00/);
  await expect(outboxRows(page).getByRole('button', { name: 'Cancel' })).toBeVisible();
  app.gmail.offline = true; // Gmail cannot be reached: it fails, and is never sent again by itself
  await outboxRows(page).getByRole('button', { name: 'Send now' }).click();
  await expect(outboxRows(page).locator('.outbox-state')).toContainText('Did not go', { timeout: 15_000 });
  await expect(outboxRows(page)).toContainText('Look in Gmail’s Sent');
  await expect(tab(page, 'Outbox')).toContainText('1 failed');
  await page.waitForTimeout(3000);
  expect(app.gmail.outgoing.length).toBe(0);
  app.gmail.offline = false;
  await outboxRows(page).getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Nothing waiting to go.')).toBeVisible({ timeout: 15_000 });
  expect(app.gmail.outgoing.length).toBe(1);
  await expect(tab(page, 'Sent')).toBeVisible();
  await tab(page, 'Sent').click();
  await expect(rows(page).first().locator('.mail-subject')).toHaveText('Onboarding call on Thursday?');
});

test('the Library shows the Outbox mail row and the Split tabs with Sent and Outbox', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.locator('.outbox-row.is-mail')).toHaveCount(2);
  await expect(page.locator('.mail-splits').first().getByRole('tab')).toHaveText([/Inbox/, /Drafts/, /Sent/, /Outbox.*1 failed/, /Done/, /Important/, /Calendar/, /Money/, /Newsletters/, /Other/]);
});

test('a mail being written is a draft in Drafts as you type: it survives a reload, Continue writing fills the composer, Discard has Undo', async ({ page, app, isMobile }) => {
  await writer(app, { send: true });
  await page.goto(`${app.url}/mail`);
  await page.getByRole('button', { name: 'New email' }).click();
  await expect(composerOf(page).getByLabel('To')).toBeFocused();
  expect((await fetch(`${app.url}/api/mail/unsent`).then((r) => r.json())).length).toBe(0); // an empty composer keeps nothing
  await page.keyboard.type('lena@nordlicht.example');
  await composerOf(page).getByLabel('Subject').click();
  await page.keyboard.type('Plans for spring');
  await composerOf(page).getByLabel('Your mail').click();
  await page.keyboard.type('First thoughts on the garden.');
  await expect(composerOf(page).locator('.mail-draft-status')).toContainText('Draft saved');
  await page.reload();
  await expect(tab(page, 'Drafts')).toContainText('1');
  await expect(tab(page, 'Outbox')).toHaveCount(0); // nothing on its way
  await tab(page, 'Drafts').click();
  await expect(draftRows(page)).toHaveCount(1);
  await expect(draftRows(page)).toContainText('Draft');
  await expect(draftRows(page)).toContainText('To lena@nordlicht.example');
  await expect(draftRows(page)).toContainText('Plans for spring');
  await expect(draftRows(page)).toContainText('First thoughts on the garden.');
  await draftRows(page).getByRole('button', { name: 'Continue writing' }).click();
  await expect(composerOf(page).getByLabel('Your mail')).toHaveValue('First thoughts on the garden.');
  await expect(composerOf(page).getByLabel('To')).toHaveValue('lena@nordlicht.example');
  await composerOf(page).getByLabel('Your mail').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More.');
  await composerOf(page).getByRole('button', { name: 'Close' }).click();
  await expect(composerOf(page)).toHaveCount(0);
  await backToList(page, isMobile);
  await expect(draftRows(page)).toContainText('First thoughts on the garden. More.');
  await draftRows(page).getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText('No drafts.')).toBeVisible();
  await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click();
  await expect(draftRows(page)).toHaveCount(1);
  expect(app.gmail.outgoing.length).toBe(0); // a draft is never sent, and never copied to Gmail
});

test('a reply’s draft stays with its conversation: closed, it shows there; r continues it; sent, it leaves Drafts', async ({ page, app }) => {
  test.setTimeout(60_000);
  await writer(app, { send: true });
  await openLena(page, app);
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Your answer')).toBeFocused();
  await page.keyboard.type('Half an answer');
  await expect(composerOf(page).locator('.mail-draft-status')).toContainText('Draft saved');
  await page.keyboard.press('Escape');
  await expect(composerOf(page)).toHaveCount(0);
  await openLena(page, app);
  await expect(page.locator('.mail-draft-line')).toContainText('Half an answer');
  expect((await fetch(`${app.url}/api/mail/inbox?split=drafts`).then((r) => r.json())).counts.drafts).toBe(1);
  await page.keyboard.press('r');
  await expect(composerOf(page).getByLabel('Your answer')).toHaveValue(/^Half an answer\n\nOn .+ wrote:/);
  await expect(composerOf(page).getByLabel('Subject')).toHaveValue('Re: Onboarding call on Thursday?');
  await composerOf(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.mail-sending')).toHaveText('Sent.', { timeout: 25_000 });
  const view = await fetch(`${app.url}/api/mail/inbox?split=outbox`).then((r) => r.json());
  expect([view.outbox.drafts.length, view.counts.outbox]).toEqual([0, 0]);
  expect(app.gmail.outgoing.length).toBe(1);
});

test('each mail in a conversation has Reply: the answer is to that mail, says whose it is and when, quotes it, and marks it', async ({ page, app }) => {
  await writer(app, { send: true });
  await openLena(page, app);
  const lenas = page.locator('.mail-message').filter({ has: page.locator('.mail-message-head strong', { hasText: /Lena/ }) });
  const first = lenas.first();
  await first.getByRole('button', { name: /^Reply to / }).click();
  const form = composerOf(page);
  await expect(form).toBeVisible();
  await expect(form.locator('.mail-replying-to')).toContainText(/Replying to .*Lena/);
  await expect(form.getByLabel('To')).toHaveValue('lena@nordlicht.example');
  await expect(form.getByLabel('Subject')).toHaveValue(/^Re: /);
  await expect(form.getByLabel('Your answer')).toHaveValue(/^\n\nOn .+ wrote:\n> /);
  await expect(form.getByLabel('Your answer')).toBeFocused();
  await expect(first).toHaveClass(/is-replying/);
  await expect(page.locator('.mail-message.is-replying')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('reply-on-a-mail.png'), fullPage: true });
  // Once you have written, another Reply does not throw your words away.
  await page.keyboard.type('Thank you.');
  await page.locator('.mail-reply-top').click();
  await expect(form.getByLabel('Your answer')).toHaveValue(/^Thank you\./);
  await expect(form.locator('.capture-problem')).toContainText('You are writing an answer already');
  await page.keyboard.press('Escape');
  await expect(composerOf(page)).toHaveCount(0);
  await expect(page.locator('.mail-message.is-replying')).toHaveCount(0);
  expect(app.gmail.outgoing.length).toBe(0);
});

test('a conversation shows the newest mail first; one press turns it to oldest first, and that is kept after a reload', async ({ page, app }) => {
  await writer(app, { send: true });
  await openLena(page, app);
  const heads = page.locator('.mail-message .mail-message-when');
  await expect(heads.first()).toContainText('5:00');
  await expect(page.getByRole('button', { name: /^Newest first/ })).toBeVisible();
  await page.locator('.mail-message').first().getByRole('button', { name: /^Reply to / }).click();
  await expect(page.locator('.mail-reader .mail-compose-place + .mail-message')).toHaveCount(1); // newest first: the composer above the mails
  await page.screenshot({ path: test.info().outputPath('newest-first.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.locator('.mail-order').click();
  await expect(heads.first()).toContainText('10:00');
  await expect(page.getByRole('button', { name: /^Oldest first/ })).toBeVisible();
  await page.reload();
  await expect(page.locator('.mail-message .mail-message-when').first()).toContainText('10:00');
  expect(app.gmail.outgoing.length).toBe(0);
});
