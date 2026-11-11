// Google Calendar (Calendar in depth 7): "Read your calendar" is a switch on the shared Google sign-in; with it on, your Google events
// are on your days with a small G, read only, and in the Planner as fixed anchors. Google and its Calendar are stood in for
// (tests/fake-google.js, tests/fake-gcal.js): no real Google, no real client.
import { test, expect } from './fixtures.js';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, SCOPES } from '../fake-google.js';

const google = (page) => page.getByRole('region', { name: 'Google', exact: true });
const account = (page) => google(page).locator('.google-account');
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

async function signedIn(page, app) {
  await page.goto(`${app.url}/settings`);
  await google(page).getByLabel('Google client ID').fill(FAKE_CLIENT_ID);
  await google(page).getByLabel('Google client secret').fill(FAKE_CLIENT_SECRET);
  await google(page).getByRole('button', { name: 'Save client' }).click();
  await google(page).getByRole('button', { name: 'Add a Google account' }).click();
  await expect(account(page)).toContainText('work@mypractice.com');
}

test('switch “Read your calendar” on: Google is asked for that permission only, the events are read at once and shown with a G, read only', async ({ page, app }) => {
  await app.gcal.add({ id: 'kickoff', summary: 'Kick-off Nordlicht', start: `${dayOf(0)}T10:00`, end: `${dayOf(0)}T11:00`, meet: 'https://meet.example/abc-defg-hij',
    attendees: [{ email: 'jonas@hafenkante.example', displayName: 'Jonas Weber', responseStatus: 'accepted' }, { email: 'work@mypractice.com', self: true, responseStatus: 'needsAction' }] });
  await signedIn(page, app);
  const read = account(page).locator('[data-permission="calendar.read"]');
  const change = account(page).locator('[data-permission="calendar.modify"]');
  await expect(read).toContainText('Read your calendar');
  await expect(change).toContainText('Change your calendar');
  await expect(change.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await read.getByRole('button', { name: 'On' }).click(); // goes to Google, and comes back
  await expect(read.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await expect(change.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  expect(app.google.seen.filter((c) => c.path === '/auth').map((c) => c.params.scope.split(' ').slice(2))).toEqual([[], [SCOPES.calendarRead]]);

  // Read at once, and the job is in Background jobs.
  const part = page.getByRole('region', { name: 'Google Calendar', exact: true });
  await expect(part.locator('[data-gcal="work@mypractice.com"]')).toContainText(/Read .* · 1 event/);
  await expect(page.locator('[data-job="google-calendar-read"]')).toContainText('Read your Google calendars');

  // On the Calendar: a small G, and the event opens read only with its guests, their answers and the Meet link.
  await page.goto(`${app.url}/calendar?view=day`);
  const event = page.getByRole('button', { name: /Kick-off Nordlicht/ });
  await expect(event.locator('.g-mark')).toBeVisible();
  await event.click();
  const dialog = page.getByRole('dialog', { name: 'Event' });
  await expect(dialog).toContainText('read only');
  await expect(dialog).toContainText('Jonas Weber');
  await expect(dialog).toContainText('Accepted');
  await expect(dialog.getByRole('link', { name: 'Join with Google Meet' })).toHaveAttribute('href', 'https://meet.example/abc-defg-hij');
  await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // In the Planner it is a fixed anchor with a G, in the day and in the Order.
  await page.goto(`${app.url}/planner`);
  await expect(page.locator('.plan-event', { hasText: 'Kick-off Nordlicht' }).locator('.g-mark')).toBeVisible();
  await page.goto(`${app.url}/planner?lens=order`);
  await expect(page.locator('.order-anchor', { hasText: 'Kick-off Nordlicht' }).locator('.g-mark')).toBeVisible();
});

test('switching it off takes Google’s events from your days and your own stay; on again brings them back', async ({ page, app }) => {
  await app.gcal.add({ id: 'g1', summary: 'In Google', start: `${dayOf(0)}T10:00`, end: `${dayOf(0)}T11:00` });
  await signedIn(page, app);
  const read = () => account(page).locator('[data-permission="calendar.read"]');
  await read().getByRole('button', { name: 'On' }).click();
  await expect(read().getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await fetch(`${app.url}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Mine', starts_at: `${dayOf(0)}T14:00`, ends_at: `${dayOf(0)}T15:00` }) });

  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(2);
  await page.goto(`${app.url}/settings`);
  await read().getByRole('button', { name: 'Off' }).click();
  await expect(read().getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Google Calendar', exact: true })).toContainText('Nothing is read');
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Mine/ })).toBeVisible();

  await page.goto(`${app.url}/settings`);
  await read().getByRole('button', { name: 'On' }).click();
  await expect(read().getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(2);
});

test('Google Calendar has its row in Modules; off, its events and part of Settings go and the sign-in stays', async ({ page, app }) => {
  await app.gcal.add({ id: 'g1', summary: 'In Google', start: `${dayOf(0)}T10:00`, end: `${dayOf(0)}T11:00` });
  await signedIn(page, app);
  await account(page).locator('[data-permission="calendar.read"]').getByRole('button', { name: 'On' }).click();
  await expect(page.getByRole('region', { name: 'Google Calendar', exact: true })).toContainText(/1 event/);
  const row = page.locator('[data-module="calendar-google"]');
  await expect(row).toContainText('Google Calendar');
  await row.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Google Calendar', exact: true })).toHaveCount(0);
  await expect(account(page)).toContainText('work@mypractice.com'); // the sign-in stays
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(0);
});

test('the Library shows the G mark', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.locator('.lib-g-mark .g-mark')).toBeVisible();
});
