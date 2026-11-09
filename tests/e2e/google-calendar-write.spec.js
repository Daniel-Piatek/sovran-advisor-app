// Google Calendar, two ways, safely (Calendar in depth 8): "Change your calendar" is its own switch; a change shows at once with a mark
// and waits in an outbox with its etag, goes to Google with If-Match, and a clash keeps Google's version and asks you.
// Google and its Calendar are stood in for (tests/fake-google.js, tests/fake-gcal.js): no real Google.
import { test, expect } from './fixtures.js';
import { FAKE_CLIENT_ID, FAKE_CLIENT_SECRET, SCOPES } from '../fake-google.js';

const google = (page) => page.getByRole('region', { name: 'Google', exact: true });
const account = (page) => google(page).locator('.google-account');
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const iso = (local) => new Date(local).toISOString();

async function ready(page, app, { change = true } = {}) {
  app.gcal.add({ id: 'kickoff', summary: 'Kick-off Nordlicht', start: `${dayOf(0)}T10:00`, end: `${dayOf(0)}T11:00` });
  app.gcal.add({ id: 'theirs', summary: 'Their meeting', start: `${dayOf(0)}T14:00`, end: `${dayOf(0)}T15:00`, organizer: { email: 'jonas@hafenkante.example', displayName: 'Jonas Weber' },
    attendees: [{ email: 'work@mypractice.com', self: true, responseStatus: 'accepted' }] });
  await page.goto(`${app.url}/settings`);
  await google(page).getByLabel('Google client ID').fill(FAKE_CLIENT_ID);
  await google(page).getByLabel('Google client secret').fill(FAKE_CLIENT_SECRET);
  await google(page).getByRole('button', { name: 'Save client' }).click();
  await google(page).getByRole('button', { name: 'Add a Google account' }).click();
  await expect(account(page)).toContainText('work@mypractice.com');
  const read = account(page).locator('[data-permission="calendar.read"]');
  await read.getByRole('button', { name: 'On' }).click();
  await expect(read.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  if (change) {
    const modify = () => account(page).locator('[data-permission="calendar.modify"]');
    await modify().getByRole('button', { name: 'On' }).click();
    await expect(modify().getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('region', { name: 'Google Calendar', exact: true })).toContainText(/Read .* · 2 events/);
}

const block = (page, title) => page.getByRole('button', { name: new RegExp(`^${title}, `) });

test('“Change your calendar” asks Google for that one permission; the three guards are in Settings, and the fields are switches', async ({ page, app }) => {
  await ready(page, app);
  expect(app.google.seen.filter((c) => c.path === '/auth').map((c) => c.params.scope.split(' ').slice(2)).at(-1)).toEqual([SCOPES.calendarModify]);
  const part = page.getByRole('region', { name: 'Google Calendar', exact: true });
  await expect(part).toContainText('Only meetings you organise can be changed here.');
  await expect(part).toContainText('Only the fields switched on above can be changed.');
  await expect(part).toContainText('Every change goes with the version it was made on');
  await expect(part.getByRole('group', { name: 'Fields that may change' }).getByRole('checkbox')).toHaveCount(6);
  await part.getByLabel('Place').uncheck();
  await expect(part.getByLabel('Place')).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Google Calendar', exact: true }).getByLabel('Place')).not.toBeChecked();
});

test('move a Google event: it moves at once with a dashed G, says Waiting to go with its version, then goes to Google with If-Match', async ({ page, app }) => {
  await ready(page, app);
  const etag = app.gcal.events.get('primary').find((e) => e.id === 'kickoff').etag;
  await page.goto(`${app.url}/calendar?view=day`);
  await block(page, 'Kick-off Nordlicht').focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowDown'); // an hour later
  await expect(block(page, 'Kick-off Nordlicht')).toContainText(/11:00 AM–12:00 PM/);
  const pane = page.getByRole('region', { name: 'Google changes' });
  await expect(pane).toContainText('Kick-off Nordlicht');
  await expect(pane.locator('[data-state="waiting"]')).toContainText('Waiting to go');
  await expect(pane).toContainText(`version ${etag.replace(/"/g, '')}`);
  await expect(block(page, 'Kick-off Nordlicht').locator('.g-mark.is-waiting')).toBeVisible();

  // A moment later it has gone, once, with the version it was made on.
  await expect(pane.locator('[data-state="sent"]')).toContainText('Sent to Google', { timeout: 15_000 });
  await expect(block(page, 'Kick-off Nordlicht').locator('.g-mark.is-waiting')).toHaveCount(0);
  expect(app.gcal.patches).toHaveLength(1);
  expect(app.gcal.patches[0].ifMatch).toBe(etag);
  expect(app.gcal.events.get('primary').find((e) => e.id === 'kickoff').start.dateTime).toBe(iso(`${dayOf(0)}T11:00`));
});

test('a clash: Google changed it first, Google’s time is kept, and “Use mine” sends it again; nothing is overwritten in silence', async ({ page, app }) => {
  await ready(page, app);
  await page.goto(`${app.url}/calendar?view=day`);
  // Someone moves it in Google before this app has read Google again.
  app.gcal.change('primary', 'kickoff', { start: { dateTime: iso(`${dayOf(0)}T15:00`) }, end: { dateTime: iso(`${dayOf(0)}T16:00`) } });
  await block(page, 'Kick-off Nordlicht').focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowDown');
  const pane = page.getByRole('region', { name: 'Google changes' });
  const clash = pane.locator('[data-state="clash"]');
  await expect(clash).toContainText('was changed in Google too', { timeout: 15_000 });
  await expect(clash).toContainText('Google’s version was kept');
  await expect(block(page, 'Kick-off Nordlicht')).toContainText(/3:00 PM–4:00 PM/);
  await expect(block(page, 'Kick-off Nordlicht').locator('.g-mark.is-clash')).toBeVisible();
  expect(app.gcal.events.get('primary').find((e) => e.id === 'kickoff').start.dateTime).toBe(iso(`${dayOf(0)}T15:00`));

  await clash.getByRole('button', { name: 'Use mine' }).click();
  await expect(pane.locator('[data-state="sent"]')).toContainText('Sent to Google', { timeout: 15_000 });
  expect(app.gcal.events.get('primary').find((e) => e.id === 'kickoff').start.dateTime).toBe(iso(`${dayOf(0)}T11:00`));
});

test('Keep Google’s lets the change go and sends nothing', async ({ page, app }) => {
  await ready(page, app);
  await page.goto(`${app.url}/calendar?view=day`);
  app.gcal.change('primary', 'kickoff', { summary: 'Renamed in Google' });
  await block(page, 'Kick-off Nordlicht').focus();
  await page.keyboard.press('ArrowDown');
  const clash = page.getByRole('region', { name: 'Google changes' }).locator('[data-state="clash"]');
  await expect(clash).toBeVisible({ timeout: 15_000 });
  await clash.getByRole('button', { name: 'Keep Google’s' }).click();
  await expect(page.getByRole('region', { name: 'Google changes' })).toBeHidden();
  await expect(block(page, 'Renamed in Google')).toBeVisible();
  expect(app.gcal.patches.every((p) => p.ifMatch)).toBe(true);
  expect(app.gcal.events.get('primary').find((e) => e.id === 'kickoff').summary).toBe('Renamed in Google');
});

test.describe('a field switched off', () => {
  test.use({ expectedConsoleErrors: [/403/] }); // the refusal is the point
  test('someone else’s meeting stays read only, and a field switched off is refused in words', async ({ page, app }) => {
  await ready(page, app);
  await page.goto(`${app.url}/calendar?view=day`);
  await block(page, 'Their meeting').click();
  await expect(page.getByRole('dialog', { name: 'Event' })).toContainText('read only');
  await page.getByRole('dialog', { name: 'Event' }).getByRole('button', { name: 'Close' }).click();

  await page.goto(`${app.url}/settings`);
  await page.getByRole('region', { name: 'Google Calendar', exact: true }).getByLabel('Place').uncheck();
  await page.goto(`${app.url}/calendar?view=day`);
  await block(page, 'Kick-off Nordlicht').click();
  const dialog = page.getByRole('dialog', { name: 'Event' });
  await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0); // a Google event is never deleted here
  await dialog.getByLabel('Place').fill('Elsewhere');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toContainText('“Place” is switched off for changes');
  expect(app.gcal.patches).toHaveLength(0);
  });
});

test('with “Change your calendar” off nothing can change and nothing goes to Google', async ({ page, app }) => {
  await ready(page, app, { change: false });
  await page.goto(`${app.url}/calendar?view=day`);
  await block(page, 'Kick-off Nordlicht').focus();
  await page.keyboard.press('ArrowDown');
  await block(page, 'Kick-off Nordlicht').click();
  await expect(page.getByRole('dialog', { name: 'Event' })).toContainText('read only');
  await page.waitForTimeout(3500);
  expect(app.gcal.patches).toHaveLength(0);
});

test('the Library shows the four states of the Sync mark', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.locator('.lib-sync-mark [data-sync="waiting"] .g-mark.is-waiting')).toBeVisible();
  await expect(page.locator('.lib-sync-mark [data-sync="clash"] .g-mark.is-clash')).toBeVisible();
  await expect(page.locator('.lib-sync-mark [data-sync="failed"] .g-mark.is-failed')).toBeVisible();
});
