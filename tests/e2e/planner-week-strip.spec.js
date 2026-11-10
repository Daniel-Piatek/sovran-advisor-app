// The week strip above the day, Tasks to place, and the Plan my day dialog.
import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };
const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDay(d); };
const post = (app, url, body) => fetch(`${app.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const tasks = (app) => fetch(`${app.url}/api/tasks`).then((r) => r.json());
const strip = (page) => page.getByRole('navigation', { name: 'This week' });
const toPlace = (page) => page.getByRole('complementary', { name: 'Tasks to place' });

test('the week strip: seven days with what each holds; a click opens that day, and back', async ({ page, app }) => {
  const today = localDay();
  const other = today === monday() ? inDays(1) : monday();
  await post(app, '/api/events', { title: 'Workshop', starts_at: `${other}T09:00`, ends_at: `${other}T17:00` });
  await post(app, '/api/tasks', { text: 'Sort the attic', due: other, estimate: 60 });
  await post(app, '/api/tasks', { text: 'Pay rent', due: today, estimate: 10 });
  await page.goto(`${app.url}/planner`);
  const days = strip(page).getByRole('button');
  await expect(days).toHaveCount(7);
  await expect(strip(page).locator(`[data-day="${monday()}"]`)).toContainText(new Date(`${monday()}T12:00`).toLocaleDateString(undefined, { weekday: 'short' }));
  await expect(strip(page).locator(`[data-day="${today}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(strip(page).locator(`[data-day="${today}"]`)).toContainText('1 task');
  await expect(strip(page).locator(`[data-day="${other}"]`)).toContainText('1 event · 1 task');
  await expect(strip(page).locator(`[data-day="${other}"] .load-bar`)).toHaveClass(/is-over/); // 8 h + 1 h of 8 h
  await expect(strip(page).getByRole('button', { name: /: Free/ }).first()).toBeVisible();

  await strip(page).locator(`[data-day="${other}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/planner/${other}$`));
  await expect(strip(page).locator(`[data-day="${other}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tray-rows.is-day .tray-row')).toHaveText([/Sort the attic/]);
  await expect(page.getByRole('button', { name: 'Plan this day' })).toBeVisible();
  await strip(page).locator(`[data-day="${today}"]`).click();
  await expect(page).toHaveURL(new RegExp('/planner$'));
  await expect(page.getByRole('button', { name: 'Plan my day' })).toBeVisible();
});

test('Tasks to place: Due (missed), Upcoming and No date; Place pulls an upcoming task into the day', async ({ page, app }) => {
  await post(app, '/api/tasks', { text: 'Renew insurance', due: inDays(-3) });
  await post(app, '/api/tasks', { text: 'Book the kickoff room', due: inDays(3), estimate: 30 });
  await post(app, '/api/tasks', { text: 'Call the dentist', estimate: 15 });
  await page.goto(`${app.url}/planner`);
  await expect(toPlace(page).getByRole('heading', { name: 'Tasks to place' })).toBeVisible();
  await expect(toPlace(page).getByRole('list', { name: 'Missed' }).locator('.tray-row')).toContainText(['Renew insurance']);
  await expect(toPlace(page).getByRole('list', { name: 'Missed' }).locator('.tray-row')).toContainText(['missed']);
  const upcoming = toPlace(page).getByRole('list', { name: 'Upcoming' });
  await expect(upcoming.locator('.tray-row')).toContainText(['Book the kickoff room']);
  await expect(toPlace(page).getByRole('list', { name: 'No date' }).locator('.tray-row')).toContainText(['Call the dentist']);
  await upcoming.getByRole('button', { name: 'Place' }).click();
  await expect(page.locator('.plan-slot', { hasText: 'Book the kickoff room' })).toBeVisible();
  await expect(toPlace(page).getByRole('list', { name: 'Upcoming' })).toHaveCount(0);
  expect((await tasks(app)).find((t) => t.text === 'Book the kickoff room').due).toBe(localDay());
});

test('Plan my day: what is still free, tick what belongs, Put them in the day; Cancel puts nothing', async ({ page, app }) => {
  await post(app, '/api/events', { title: 'Workshop', starts_at: `${localDay()}T09:00`, ends_at: `${localDay()}T11:00` });
  await post(app, '/api/tasks', { text: 'Book the kickoff room', due: inDays(2), estimate: 30 });
  await post(app, '/api/tasks', { text: 'Call the dentist', estimate: 15 });
  await post(app, '/api/tasks', { text: 'Sort the attic', estimate: 120 });
  await page.goto(`${app.url}/planner`);
  await page.getByRole('button', { name: 'Plan my day' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plan the day' });
  await expect(dialog.getByRole('heading', { name: 'Plan my day' })).toBeVisible();
  await expect(dialog).toContainText('6 h of the day are still free. Pick what belongs in it.'); // 8 h less the 2 h workshop
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.plan-slot')).toHaveCount(0);

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('p');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: /Book the kickoff room/ }).check();
  await dialog.getByRole('checkbox', { name: /Call the dentist/ }).check();
  await expect(dialog.getByRole('status')).toHaveText('Picked 45 min · 5 h 15 still free');
  await dialog.getByRole('button', { name: 'Put them in the day' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.plan-slot')).toHaveCount(2);
  await expect(page.locator('.plan-slot', { hasText: 'Book the kickoff room' })).toBeVisible();
  const mine = await tasks(app);
  expect(mine.filter((t) => t.due === localDay()).map((t) => t.text).sort()).toEqual(['Book the kickoff room', 'Call the dentist']);
  expect(mine.find((t) => t.text === 'Sort the attic').due).toBe('');
});

test('a long task shows its few words in Tasks to place; a click opens it in the pop-up with the whole title', async ({ page, app }) => {
  const long = 'Have to figure out how to iterate this thing so that I duplicate it as the changes come in';
  await post(app, '/api/tasks', { text: long });
  await expect.poll(async () => (await tasks(app)).find((t) => t.text === long).short_text, { timeout: 10_000 }).toBe('Have to figure');
  await page.goto(`${app.url}/planner`);
  await toPlace(page).getByRole('list', { name: 'No date' }).getByRole('button', { name: 'Have to figure' }).click();
  await expect(page.getByRole('dialog', { name: 'Task' }).getByLabel('The task’s words')).toHaveValue(long);
});
