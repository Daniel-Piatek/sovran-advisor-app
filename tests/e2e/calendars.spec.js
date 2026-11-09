import http from 'node:http';
import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const compact = (day) => day.replaceAll('-', '');

// A work calendar served here, never from the internet: a weekly meeting today at 10:00
// (this computer's time), and a whole-day offsite today.
function workCalendar() {
  const d = compact(localDay());
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', 'X-WR-CALNAME:Work',
    'BEGIN:VEVENT', 'UID:weekly@test', 'DTSTAMP:20261001T000000Z', 'SUMMARY:Team meeting', 'LOCATION:Room 4',
    `DTSTART:${d}T100000`, `DTEND:${d}T110000`, 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:offsite@test', 'DTSTAMP:20261001T000000Z', 'SUMMARY:Offsite',
    `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${compact(localDay(new Date(Date.now() + 86_400_000)))}`, 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');
}

test.beforeEach(async ({}, testInfo) => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/calendar' }); res.end(workCalendar()); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  testInfo.icsUrl = `http://127.0.0.1:${server.address().port}/work.ics`;
  testInfo.icsServer = server;
});
test.afterEach(async ({}, testInfo) => { testInfo.icsServer.close(); });

test('paste a calendar’s link: its meetings appear, read only, in its colour', async ({ page, app }, testInfo) => {
  await page.goto(`${app.url}/calendar?view=day`);
  const panel = page.getByRole('region', { name: 'Your calendars' });
  await expect(panel).toContainText('My events');
  await panel.getByLabel('Calendar link').fill(testInfo.icsUrl);
  await panel.getByRole('button', { name: 'Add calendar' }).click();
  await expect(panel.getByText('“Work” added.')).toBeVisible();
  await expect(panel.locator('.cal-calendar-name')).toHaveText(['My events', 'Work']);
  await expect(panel.locator('.cal-calendar-state').nth(1)).toHaveText(/read/);

  const meeting = page.getByRole('button', { name: /Team meeting, .*Work/ });
  await expect(meeting).toBeVisible();
  const line = await meeting.evaluate((node) => getComputedStyle(node).borderLeftColor);
  const own = await page.evaluate(() => { const p = document.createElement('div'); p.style.color = 'var(--cal-2)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  expect(line).toBe(own);
  await expect(page.locator('.cal-allday-event')).toHaveText(['Offsite']);

  // Read only: it opens to read; a drag does not move it.
  await meeting.click();
  const dialog = page.getByRole('dialog', { name: 'Event' });
  await expect(dialog).toContainText('Work · read only');
  await expect(dialog).toContainText('Room 4');
  await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await meeting.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Team meeting, 10:00/ })).toBeVisible();
});

test('a calendar can change colour, and be removed with Undo', async ({ page, app }, testInfo) => {
  await fetch(`${app.url}/api/calendars`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: testInfo.icsUrl, name: 'Team' }) });
  await page.goto(`${app.url}/calendar?view=day`);
  const panel = page.getByRole('region', { name: 'Your calendars' });
  await expect(panel.locator('.cal-calendar-name')).toHaveText(['My events', 'Team']);
  await panel.getByRole('button', { name: 'Change Team’s colour' }).click();
  await expect.poll(async () => (await (await fetch(`${app.url}/api/calendars`)).json())[0].colour).toBe(3);
  await panel.getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await expect(page.getByText('“Team” removed.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);
});

test.describe('a bad link', () => {
  test.use({ expectedConsoleErrors: [/400/] });
  test('a link that is not a calendar says so, and nothing breaks', async ({ page, app }) => {
  await page.goto(`${app.url}/calendar?view=day`);
  const panel = page.getByRole('region', { name: 'Your calendars' });
  await panel.getByLabel('Calendar link').fill('file:///etc/hosts');
  await page.keyboard.press('Enter');
  await expect(panel.getByText(/not a calendar link/)).toBeVisible();
  });
});

test('today’s journal shows its meetings; Note starts a note that links to the event', async ({ page, app }, testInfo) => {
  const today = localDay();
  await fetch(`${app.url}/api/calendars`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: testInfo.icsUrl }) });
  await fetch(`${app.url}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Dentist', starts_at: `${today}T15:00`, ends_at: `${today}T16:00` }) });
  await page.goto(`${app.url}/journal`);
  const events = page.getByRole('region', { name: 'Events' });
  await expect(events.locator('.day-event-title')).toHaveText(['Offsite · Work', 'Team meeting · Work', 'Dentist']);
  await expect(events.locator('.day-event-when').first()).toHaveText('all day');

  await events.locator('.day-event', { hasText: 'Team meeting' }).getByRole('button', { name: 'Note' }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Title')).toHaveValue(/^Team meeting · /);
  const link = page.getByRole('textbox', { name: 'Text', exact: true }).locator('.page-link');
  await expect(link).toContainText('Team meeting');
  await expect(link.locator('.page-link-kind')).toHaveText('◷');
  await page.getByRole('textbox', { name: 'Text', exact: true }).press('End');
  await page.keyboard.type('Agreed the dates.');
  await expect(page.getByRole('status')).toHaveText('Saved');

  // The link opens the event in the Calendar, which lists the note.
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${today}\\?view=day`));
  const dialog = page.getByRole('dialog', { name: 'Event' });
  await expect(dialog).toContainText('Team meeting');
  await expect(dialog.getByRole('region', { name: 'Notes about it' }).locator('.linked-from-row')).toContainText('Agreed the dates.');
  await expect(dialog.getByRole('button', { name: 'Open note' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Back on the day, the meeting has its note: a second click opens the same one.
  await page.goto(`${app.url}/journal`);
  await events.locator('.day-event', { hasText: 'Team meeting' }).getByRole('button', { name: 'Open note' }).click();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toContainText('Agreed the dates.');
  expect((await (await fetch(`${app.url}/api/notes`)).json()).length).toBe(1);
});

test('your own event’s dialog starts a note too', async ({ page, app }) => {
  const today = localDay();
  await fetch(`${app.url}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Call with Jonas', starts_at: `${today}T11:00`, ends_at: `${today}T11:30` }) });
  await page.goto(`${app.url}/calendar?view=day`);
  await page.getByRole('button', { name: /Call with Jonas/ }).click();
  await page.getByRole('dialog', { name: 'Event' }).getByRole('button', { name: 'Note' }).click();
  await expect(page.getByLabel('Title')).toHaveValue(/^Call with Jonas · /);
});

test('another calendar’s events are filled with its colour’s pale fill, on the Calendar and on the Planner’s day', async ({ page, app }, testInfo) => {
  await fetch(`${app.url}/api/calendars`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: testInfo.icsUrl }) });
  const fill = (n) => page.evaluate((v) => { const p = document.createElement('i'); p.style.background = `var(--cal-${v}-fill)`; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }, n);
  await page.goto(`${app.url}/calendar?view=day`);
  const meeting = page.locator('.cal-event', { hasText: 'Team meeting' });
  await expect(meeting).toBeVisible();
  expect(await meeting.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(await fill(2));
  await page.goto(`${app.url}/planner`);
  const block = page.locator('.plan-event', { hasText: 'Team meeting' });
  await expect(block).toBeVisible();
  expect(await block.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(await fill(2));
});

test('My events have a colour too: teal at first, and the colour button in Your calendars changes it everywhere', async ({ page, app }) => {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await fetch(`${app.url}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Dentist', starts_at: `${day}T10:00`, ends_at: `${day}T11:00` }) });
  const fill = (n) => page.evaluate((v) => { const p = document.createElement('i'); p.style.background = `var(--cal-${v}-fill)`; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; }, n);
  await page.goto(`${app.url}/calendar?view=day`);
  const dentist = page.locator('.cal-event', { hasText: 'Dentist' });
  expect(await dentist.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(await fill(1));
  await page.getByRole('region', { name: 'Your calendars' }).getByRole('button', { name: 'Change My events’ colour' }).click();
  await expect.poll(async () => (await (await fetch(`${app.url}/api/calendars/own`)).json()).colour).toBe(2);
  await expect.poll(async () => page.locator('.cal-event', { hasText: 'Dentist' }).evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(await fill(2));
  await page.goto(`${app.url}/planner`);
  expect(await page.locator('.plan-event', { hasText: 'Dentist' }).evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(await fill(2));
});

test('Calendar links is a module: off, the pane and its events go and the rows stay; Settings lists its job', async ({ page, app }, testInfo) => {
  await page.goto(`${app.url}/calendar?view=day`);
  const panel = page.getByRole('region', { name: 'Your calendars' });
  await panel.getByLabel('Calendar link').fill(testInfo.icsUrl);
  await panel.getByRole('button', { name: 'Add calendar' }).click();
  await expect(panel.getByText('“Work” added.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Team meeting, .*Work/ })).toBeVisible();

  // Settings › Background jobs says what runs, how often and when it last did.
  await page.goto(`${app.url}/settings`);
  const job = page.locator('[data-job="calendar-read"]');
  await expect(job).toContainText('Read your other calendars');
  await expect(job).toContainText(/Every 10 minutes · last ran/);

  // Switch the module off.
  await page.locator('[data-module="calendar-links"]').getByRole('button', { name: 'Off' }).click();
  await expect(job).toContainText('Off');
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(panel).toContainText('My events');
  await expect(panel).toContainText('Calendar links are switched off');
  await expect(panel.getByLabel('Calendar link')).toBeHidden();
  await expect(panel.locator('.cal-calendar-name')).toHaveText(['My events']);
  await expect(page.getByRole('button', { name: /Team meeting/ })).toHaveCount(0);

  // On again: the calendar and its events come back, nothing lost.
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="calendar-links"]').getByRole('button', { name: 'On' }).click();
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(panel.locator('.cal-calendar-name')).toHaveText(['My events', 'Work']);
  await expect(page.getByRole('button', { name: /Team meeting, .*Work/ })).toBeVisible();
});

test('the Library shows the Calendar link row', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  const row = page.locator('[data-calendar-link="Family"]');
  await expect(row).toContainText('Family');
  await expect(row).toContainText(/read 4 min/);
  await expect(page.locator('[data-calendar-link="School"]')).toContainText('The link did not answer');
});
