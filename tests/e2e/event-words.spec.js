// Calendar in depth, lesson 5: an event from a sentence. ⌘K (Ctrl K) in the Calendar opens the field, every key shows what
// Enter will make, Enter makes it, and the people it knows are linked.

import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(`${app.url}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const nextThursday = () => { const d = new Date(); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7)); return localDay(d); };

test('⌘K in the Calendar reads a sentence, shows what Enter will make, and makes it with the person linked', async ({ page, app, isMobile }) => {
  const lena = await send(app, 'POST', '/api/people', { name: 'Lena Fischer' });
  await page.goto(`${app.url}/calendar?view=day`);
  if (isMobile) await page.getByRole('button', { name: 'In words' }).click(); else await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'An event in words' });
  const field = dialog.getByLabel('The event, in words');
  await expect(field).toBeFocused();

  // Every key updates the chips; what it guessed says so.
  await field.fill('lunch with Lena at the lake');
  await expect(dialog.locator('[data-chip="title"]')).toHaveText('lunch with Lena at the lake');
  await expect(dialog.locator('[data-chip="time"]')).toContainText('no time given');
  await expect(dialog.locator('[data-chip="person"]')).toHaveText('Lena Fischer');
  await field.fill('lunch with Lena at the lake thu 12:30 1h');
  await expect(dialog.locator('[data-chip="time"]')).toHaveText(/12:30 PM–1:30 PM/);
  await expect(dialog.locator('[data-chip="time"]')).not.toContainText('no time given');
  await expect(dialog.locator('[data-chip="length"]')).toHaveText('1 h');

  // Nothing exists until Enter.
  expect((await (await fetch(`${app.url}/api/events?from=2000-01-01&to=2100-01-01`)).json()).length).toBe(0);
  await field.press('Enter');
  await expect(dialog).toBeHidden();
  const [made] = await (await fetch(`${app.url}/api/events?from=2000-01-01&to=2100-01-01`)).json();
  expect([made.title, made.starts_at, made.ends_at]).toEqual(['lunch with Lena at the lake', `${nextThursday()}T12:30`, `${nextThursday()}T13:30`]);
  // Thursday opens with the lunch selected, with "at the lake" in its title.
  await expect(page.getByRole('button', { name: /lunch with Lena at the lake/ })).toBeVisible();

  // Lena's page lists it under her events.
  await page.goto(`${app.url}/people/${lena.id}`);
  const events = page.getByRole('region', { name: 'Events with Lena' });
  await expect(events).toContainText('lunch with Lena at the lake');
  await expect(page.getByRole('region', { name: 'Mentioned in' })).not.toContainText('lunch with Lena');
  await events.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/calendar/${nextThursday()}`));
});

test('a sentence with no name is not made, and Escape lets it go', async ({ page, app, isMobile }) => {
  await page.goto(`${app.url}/calendar?view=day`);
  if (isMobile) await page.getByRole('button', { name: 'In words' }).click(); else await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'An event in words' });
  await dialog.getByLabel('The event, in words').fill('thu 12:30');
  await dialog.getByLabel('The event, in words').press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText('An event needs a name.');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect((await (await fetch(`${app.url}/api/events?from=2000-01-01&to=2100-01-01`)).json()).length).toBe(0);
});

test('⌘K is quick capture everywhere but the Calendar, and everywhere again with Calendar in depth off', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'a keyboard shortcut');
  await page.goto(`${app.url}/`);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: /capture/i })).toBeVisible();
  await page.keyboard.press('Escape');
  await send(app, 'PATCH', '/api/modules', { id: 'calendar-plus', on: false });
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.getByRole('button', { name: 'In words' })).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'An event in words' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /capture/i })).toBeVisible();
});

test('the Library shows the Sentence preview, a guess dashed and said in words', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.locator('.words-chips').first().locator('[data-chip="person"]')).toHaveText('Lena Fischer');
  await expect(page.locator('.words-chips').nth(1).locator('.words-chip.is-guess').first()).toBeVisible();
});
