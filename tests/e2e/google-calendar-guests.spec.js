// Google Calendar, guests, Meet, repeats and answers (Calendar in depth 9): a new event with a guest from People and a Meet link, a repeating
// event asks "This one" or "All", an invitation waits dashed for your answer. Google and its Calendar are stood in for: no real Google.
import { test, expect } from './fixtures.js';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET } from '../fake-google.js';

const google = (page) => page.getByRole('region', { name: 'Google', exact: true });
const account = (page) => google(page).locator('.google-account');
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const iso = (local) => new Date(local).toISOString();
const send = (app, method, url, body) => fetch(`${app.url}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

async function ready(page, app) {
  await page.goto(`${app.url}/settings`);
  await google(page).getByLabel('Google client ID').fill(FAKE_CLIENT_ID);
  await google(page).getByLabel('Google client secret').fill(FAKE_CLIENT_SECRET);
  await google(page).getByRole('button', { name: 'Save client' }).click();
  await google(page).getByRole('button', { name: 'Add a Google account' }).click();
  await expect(account(page)).toContainText('work@mypractice.com');
  for (const permission of ['calendar.read', 'calendar.modify']) {
    const row = () => account(page).locator(`[data-permission="${permission}"]`);
    await row().getByRole('button', { name: 'On' }).click();
    await expect(row().getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('region', { name: 'Google Calendar', exact: true })).toContainText(/Read .* · \d+ events?/);
}
const block = (page, title) => page.getByRole('button', { name: new RegExp(`^${title}, `) });

test('a new event in a Google calendar with a guest from People and a Meet link: it shows at once, goes to Google, the guest’s page lists it', async ({ page, app }) => {
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer', emails: 'lena@nordlicht.example' });
  app.gcal.add({ id: 'seed', summary: 'Seed', start: `${dayOf(1)}T09:00`, end: `${dayOf(1)}T10:00` }); // so the calendar list is read
  await ready(page, app);
  await page.goto(`${app.url}/calendar?view=day`);
  await page.getByRole('button', { name: 'New event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Event' });
  await dialog.getByLabel('Event name').fill('Workshop dry run');
  await dialog.getByLabel('Calendar').selectOption({ label: 'Google · work@mypractice.com' });
  await dialog.getByLabel('Guests').fill('Lena Fischer');
  await dialog.getByLabel('Guests').press('Enter');
  await expect(dialog.locator('[data-guest="Lena Fischer"]')).toBeVisible();
  await dialog.getByLabel('Add Meet link').check();
  await dialog.getByRole('button', { name: 'Add event' }).click();

  // At once, dashed; then it has gone.
  const made = block(page, 'Workshop dry run');
  await expect(made.locator('.g-mark.is-waiting')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Google changes' })).toContainText('Workshop dry run');
  await expect(page.getByRole('region', { name: 'Google changes' }).locator('[data-state="sent"]')).toBeVisible({ timeout: 15_000 });
  expect(app.gcal.inserts).toHaveLength(1);
  expect(app.gcal.inserts[0].body.attendees).toEqual([{ email: 'lena@nordlicht.example', displayName: 'Lena Fischer' }]);
  expect(app.gcal.inserts[0].body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
  // It comes back from Google with its Meet link.
  await page.goto(`${app.url}/calendar?view=day`);
  await made.click();
  await expect(page.getByRole('dialog', { name: 'Event' }).getByRole('link', { name: 'Join with Google Meet' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Event' }).getByRole('button', { name: 'Cancel' }).click();

  // Lena's page lists it under her events.
  await page.goto(`${app.url}/people/${lena.id}`);
  await expect(page.getByRole('region', { name: 'Events with Lena' })).toContainText('Workshop dry run');
});

test('a repeating event asks “This one” or “All”: All moves the series itself in Google, This one only that week, Cancel leaves it', async ({ page, app }) => {
  for (let i = 0; i < 3; i += 1) app.gcal.add({ id: `review_${i}`, summary: 'Weekly review', start: `${dayOf(7 * i)}T16:00`, end: `${dayOf(7 * i)}T17:00`, recurringEventId: 'review' });
  app.gcal.add({ id: 'review', summary: 'Weekly review', start: `${dayOf(0)}T16:00`, end: `${dayOf(0)}T17:00`, recurrence: ['RRULE:FREQ=WEEKLY'], timeZone: 'Europe/Berlin' });
  await ready(page, app);
  await page.goto(`${app.url}/calendar?view=day`);
  const review = () => block(page, 'Weekly review');

  // Cancel: nothing moves.
  await review().focus();
  await page.keyboard.press('ArrowDown');
  const ask = page.getByRole('dialog', { name: 'Which events?' });
  await expect(ask).toContainText('repeats');
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(review()).toContainText(/4:00 PM–5:00 PM/);
  expect(app.gcal.patches).toHaveLength(0);

  // All: the whole series moves a quarter of an hour.
  await review().focus();
  await page.keyboard.press('ArrowDown');
  await ask.getByRole('button', { name: 'All events' }).click();
  await expect(review()).toContainText(/4:15 PM–5:15 PM/);
  await expect(page.getByRole('region', { name: 'Google changes' }).locator('[data-state="sent"]')).toBeVisible({ timeout: 15_000 });
  const master = app.gcal.patches.at(-1);
  expect(master.id).toBe('review');
  expect(master.body.start.timeZone).toBe('Europe/Berlin');
  expect(new Date(master.body.start.dateTime).getTime()).toBe(new Date(`${dayOf(0)}T16:15`).getTime());
  expect(app.gcal.events.get('primary').filter((e) => e.recurringEventId === 'review').map((e) => new Date(e.start.dateTime).getHours() * 60 + new Date(e.start.dateTime).getMinutes())).toEqual([975, 975, 975]);

  // This one: only that week.
  await page.goto(`${app.url}/calendar?view=day`);
  await review().focus();
  await page.keyboard.press('ArrowDown');
  await ask.getByRole('button', { name: 'This one' }).click();
  await expect.poll(() => app.gcal.patches.length, { timeout: 15_000 }).toBe(2);
  expect(app.gcal.patches.at(-1).id).toBe('review_0');
});

test('an invitation waits dashed for your answer; Yes makes it solid and goes to the organiser through Google with every guest kept', async ({ page, app }) => {
  app.gcal.add({ id: 'invite', summary: 'Nordlicht review', start: `${dayOf(0)}T09:00`, end: `${dayOf(0)}T10:00`, organizer: { email: 'jonas@hafenkante.example', displayName: 'Jonas Weber' },
    attendees: [{ email: 'jonas@hafenkante.example', displayName: 'Jonas Weber', organizer: true, responseStatus: 'accepted' }, { email: 'work@mypractice.com', self: true, responseStatus: 'needsAction' }] });
  await ready(page, app);
  await page.goto(`${app.url}/calendar?view=day`);
  const invite = () => block(page, 'Nordlicht review');
  await expect(invite()).toHaveClass(/is-invitation/);
  await invite().click();
  const dialog = page.getByRole('dialog', { name: 'Event' });
  await expect(dialog).toContainText('Jonas Weber');
  await expect(dialog.getByRole('group', { name: 'Your answer' }).getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('group', { name: 'Your answer' }).getByRole('button', { name: 'Yes' }).click();
  await expect(invite()).not.toHaveClass(/is-invitation/);
  await expect(page.getByRole('region', { name: 'Google changes' }).locator('[data-state="sent"]')).toBeVisible({ timeout: 15_000 });
  const patched = app.gcal.patches.at(-1);
  expect(patched.id).toBe('invite');
  expect(patched.body.attendees.map((a) => [a.email, a.responseStatus])).toEqual([['jonas@hafenkante.example', 'accepted'], ['work@mypractice.com', 'accepted']]);
  await invite().click();
  await expect(page.getByRole('dialog', { name: 'Event' }).getByRole('group', { name: 'Your answer' }).getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
});

test('the Library shows the Answer bar', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.locator('.lib-answer-bar .answer-bar').first()).toBeVisible();
  await expect(page.locator('.lib-answer-bar .answer-bar').nth(1).getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
});
