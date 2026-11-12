import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const pad = (n) => String(n).padStart(2, '0');
const localDay = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
test.use({ expectedConsoleErrors: [/status of 400/] }); // one test logs a line that is refused, on purpose
const rows = (page) => page.locator('.timeline-row');
const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);
async function ask(page, text) {
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(text);
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
}

test('log a message to Jonas: it is the newest row on his tab and on the Timeline, and Undo takes it back', async ({ page, app }) => {
  const jonas = await send(app, 'POST', '/api/people', { name: 'Jonas Weber' });
  await app.createNote({ title: 'Older note', body: `Ask [Jonas Weber](/people/${jonas.id}).` });
  await page.goto(`${app.url}/people/${jonas.id}?tab=timeline`);
  await expect(rows(page)).toHaveCount(1);
  const log = page.locator('.log-line');
  await expect(log.getByLabel('Kind')).toHaveValue('call');
  await expect(log.getByLabel('Day')).toHaveValue(localDay());
  await log.getByLabel('Kind').selectOption('message');
  await log.getByLabel('What happened').fill('Sent the draft proposal');
  await log.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByText('Logged a message with Jonas Weber.')).toBeVisible();
  await expect(rows(page).first().locator('.timeline-text')).toHaveText('Sent the draft proposal');
  await expect(rows(page).first().locator('.timeline-where')).toHaveText('Logged · message');
  await expect(rows(page).first().locator('.timeline-via')).toHaveCount(0); // on his own tab he is no news
  await expect(rows(page)).toHaveCount(2);
  await expect(log.getByLabel('What happened')).toHaveValue('');

  // On the Timeline page: there too, marked Logged and with his name.
  await page.goto(`${app.url}/timeline`);
  const row = rows(page).filter({ hasText: 'Sent the draft proposal' });
  await expect(row.locator('.timeline-where')).toHaveText('Logged · message');
  await expect(row.locator('.timeline-via')).toHaveText('· Jonas Weber');
  await row.click();
  await expect(page).toHaveURL(`${app.url}/people/${jonas.id}?tab=timeline`);
  await expect(page.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true');

  // Undo, straight after logging.
  await page.getByLabel('What happened').fill('A mistake');
  await page.getByLabel('What happened').press('Enter');
  await expect(rows(page).first().locator('.timeline-text')).toHaveText('A mistake');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rows(page).filter({ hasText: 'A mistake' })).toHaveCount(0);
});

test('a log line needs a sentence and cannot be in the future; the company’s tab logs too, and its people’s lines are marked', async ({ page, app }) => {
  const nord = await send(app, 'POST', '/api/companies', { name: 'Nordlicht Studio' });
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer', company_id: nord.id });
  await send(app, 'POST', '/api/interactions', { about: { kind: 'person', id: lena.id }, kind: 'coffee', note: 'Coffee at the studio', when: '2026-11-01' });
  await page.goto(`${app.url}/companies/${nord.id}?tab=timeline`);
  const log = page.locator('.log-line');
  await expect(rows(page).first().locator('.timeline-text')).toHaveText('Coffee at the studio · Lena Fischer');
  await log.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByText('A log line needs a sentence.')).toBeVisible();
  expect(await (await fetch(`${app.url}/api/timeline`)).json().then((r) => r.items.length)).toBe(1);
  await log.getByLabel('Day').evaluate((input) => { input.max = ''; });
  await log.getByLabel('Day').fill('2999-01-01');
  await log.getByLabel('What happened').fill('From the future');
  await log.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByText(/That couldn't be logged: A log line is for what already happened/)).toBeVisible();
  await log.getByLabel('Day').fill('2026-11-02');
  await log.getByLabel('Kind').selectOption('meeting');
  await log.getByRole('button', { name: 'Log' }).click();
  await expect(rows(page).filter({ hasText: 'From the future' }).locator('.timeline-where')).toHaveText('Logged · meeting');
  await expect(rows(page).filter({ hasText: 'From the future' }).locator('.timeline-via')).toHaveCount(0); // the company's own line
  await expect(rows(page).first().locator('.timeline-text')).toHaveText('From the future'); // 2 Nov is after 1 Nov
});

test('the Logged chip narrows the Timeline to log lines; with People in depth off the log line goes with the tab', async ({ page, app }) => {
  const jonas = await send(app, 'POST', '/api/people', { name: 'Jonas Weber' });
  await app.createNote({ title: 'A note' });
  await send(app, 'POST', '/api/interactions', { about: { kind: 'person', id: jonas.id }, kind: 'call', note: 'Budget is approved', when: '2026-10-30' });
  await page.goto(`${app.url}/timeline`);
  await expect(rows(page)).toHaveCount(2);
  for (const name of ['Notes', 'Journal', 'Tasks', 'Events', 'Captures']) await page.getByRole('group', { name: 'Kinds' }).getByRole('button', { name }).click();
  await expect(rows(page).locator('.timeline-text')).toHaveText(['Budget is approved · Jonas Weber']);
  await page.getByLabel('Search the Timeline').fill('jonas'); // the name of who it was with finds it too
  await expect(rows(page)).toHaveCount(1);
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="people-plus"]').getByRole('button', { name: 'Off' }).click();
  await expect(page.locator('[data-module="people-plus"]').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true'); // saved before the page is left
  await page.goto(`${app.url}/people/${jonas.id}?tab=timeline`);
  await expect(page.locator('.log-line')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
});

test('Settings has Log an interaction among what the assistant may do, and the assistant logs it: a card first, then at once', async ({ page, app }) => {
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await page.goto(`${app.url}/settings`);
  const row = page.locator('.permission-row').filter({ hasText: 'Log an interaction' });
  await expect(row.getByRole('button', { name: 'Asks first' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`${app.url}/assistant`);
  await ask(page, 'Log a call with Lena Fischer: she wants the workshop in November');
  const card = page.locator('.action-card[data-kind="log_interaction"]');
  await expect(card).toContainText('Log a call with Lena Fischer: “she wants the workshop in November”');
  await expect(card).toContainText('Waiting for you');
  expect((await (await fetch(`${app.url}/api/timeline`)).json()).items).toEqual([]);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toContainText('Approved');
  const [logged] = (await (await fetch(`${app.url}/api/timeline?about=person:${lena.id}`)).json()).items;
  expect([logged.text, logged.where]).toEqual(['she wants the workshop in November', 'Logged · call']);
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toContainText('Taken back');
  expect((await (await fetch(`${app.url}/api/timeline`)).json()).items).toEqual([]);

  await page.goto(`${app.url}/settings`);
  await row.getByRole('button', { name: 'Does it alone' }).click();
  await page.goto(`${app.url}/assistant`);
  await ask(page, 'Log a coffee with Lena Fischer: quick catch-up');
  const done = page.locator('.action-card[data-kind="log_interaction"]').last();
  await expect(done).toContainText('Logged a coffee with Lena Fischer: “quick catch-up”');
  await expect(done.getByRole('button', { name: 'Undo' })).toBeVisible();
  expect((await (await fetch(`${app.url}/api/timeline?about=person:${lena.id}`)).json()).items.map((i) => i.where)).toEqual(['Logged · coffee']);
});
