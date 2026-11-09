import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };
const events = (app, from, to = from) => fetch(`${app.url}/api/events?from=${from}&to=${to}`).then((r) => r.json());
const addEvent = (app, event) => fetch(`${app.url}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) }).then((r) => r.json());
const column = (page, day) => page.locator(`.cal-column[data-day="${day}"]`);

test('an event for tomorrow at ten shows in the week view', async ({ page, app }) => {
  await page.goto(`${app.url}/calendar?view=week`);
  await page.getByRole('button', { name: 'New event' }).click();
  const dialog = page.getByRole('dialog', { name: 'Event' });
  await dialog.getByLabel('Event name').fill('Dentist');
  await dialog.getByLabel('Day').fill(inDays(1));
  await dialog.getByLabel('Starts').fill('10:00');
  await dialog.getByLabel('Ends').fill('11:00');
  await dialog.getByRole('button', { name: 'Add event' }).click();
  await expect(dialog).toBeHidden();
  const block = column(page, inDays(1)).getByRole('button', { name: /Dentist/ });
  await expect(block).toBeVisible();
  await expect(page.locator('.cal-column')).toHaveCount(7);
  expect((await events(app, inDays(1))).map((e) => [e.title, e.starts_at, e.ends_at])).toEqual([['Dentist', `${inDays(1)}T10:00`, `${inDays(1)}T11:00`]]);

  // Nothing typed is lost: after a reload it is still there, and no task is on the calendar.
  await fetch(`${app.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a task, not an event', due: inDays(1) }) });
  await page.reload();
  await expect(column(page, inDays(1)).locator('.cal-event')).toHaveText([/Dentist/]);
});

test('an event moves with the arrow keys, and by dragging', async ({ page, app }) => {
  const day = localDay();
  await addEvent(app, { title: 'Standup', starts_at: `${day}T10:00`, ends_at: `${day}T10:30` });
  await page.goto(`${app.url}/calendar/${day}?view=day`);
  const block = page.getByRole('button', { name: /Standup/ });
  await block.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: /Standup, 10:15/ })).toBeFocused();
  expect((await events(app, day))[0].starts_at).toBe(`${day}T10:15`);
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await events(app, day))[0].starts_at).toBe(`${day}T10:00`);

  // Drag it down one hour.
  await expect(page.getByRole('button', { name: /Standup, 10:00/ })).toBeVisible();
  const box = await page.getByRole('button', { name: /Standup/ }).boundingBox();
  const hour = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-height')));
  await page.mouse.move(box.x + box.width / 2, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 5 + hour / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2, box.y + 5 + hour, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await events(app, day))[0].starts_at).toBe(`${day}T11:00`);
  expect((await events(app, day))[0].ends_at).toBe(`${day}T11:30`);
  await expect(page.getByRole('dialog', { name: 'Event' })).toBeHidden(); // a drag does not open it

  // ←→ move it a day.
  await page.getByRole('button', { name: /Standup/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await events(app, inDays(1)))[0]?.starts_at).toBe(`${inDays(1)}T11:00`);
  await expect(page.getByRole('button', { name: /Standup/ })).toBeFocused();
});

test('a click opens an event to change or delete it, with Undo; a click in an empty hour starts one there', async ({ page, app }) => {
  const day = localDay();
  await addEvent(app, { title: 'Lunch with Lena', starts_at: `${day}T12:00`, ends_at: `${day}T13:00` });
  await page.goto(`${app.url}/calendar/${day}?view=day`);
  await page.getByRole('button', { name: /Lunch with Lena/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Event' });
  await expect(dialog.getByLabel('Event name')).toHaveValue('Lunch with Lena');
  await dialog.getByRole('textbox', { name: 'Note' }).fill('the new place');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await events(app, day))[0].note).toBe('the new place');

  await page.getByRole('button', { name: /Lunch with Lena/ }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('“Lunch with Lena” deleted.')).toBeVisible();
  await expect(page.locator('.cal-event')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.cal-event')).toHaveCount(1);

  // An empty hour: 15:00.
  const hour = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-height')));
  await page.locator('.cal-body').evaluate((body, h) => { body.scrollTop = 14 * h; }, hour);
  await page.locator('.cal-body').scrollIntoViewIfNeeded();
  const col = await column(page, day).boundingBox(); // measured after the scroll
  await page.mouse.click(col.x + col.width / 2, col.y + 15 * hour + hour / 4);
  await expect(dialog.getByLabel('Starts')).toHaveValue('15:00');
  await expect(dialog.getByLabel('Ends')).toHaveValue('16:00');
  await dialog.getByLabel('Event name').fill('Call the bank');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Call the bank/ })).toBeVisible();
});

test('day and week, the way between them, and a line for now', async ({ page, app, isMobile }) => {
  await page.goto(`${app.url}/calendar`);
  await expect(page.locator('.cal-column')).toHaveCount(isMobile ? 1 : 7); // a phone starts on the day
  await page.getByRole('button', { name: 'Week' }).click();
  await expect(page.locator('.cal-column')).toHaveCount(7);
  await expect(column(page, localDay()).locator('.cal-now')).toHaveCount(1);
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.locator('.cal-now')).toHaveCount(0);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.locator('.cal-now')).toHaveCount(1);
  await page.locator('.cal-day-name[aria-current="date"]').click();
  await expect(page.locator('.cal-column')).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`/calendar/${localDay()}\\?view=day$`));
});

test('a deleted event waits in Recently deleted', async ({ page, app }) => {
  const day = localDay();
  const event = await addEvent(app, { title: 'Old meeting', starts_at: `${day}T09:00`, ends_at: `${day}T09:30` });
  await fetch(`${app.url}/api/events/${event.id}`, { method: 'DELETE' });
  await page.goto(`${app.url}/deleted`);
  const row = page.locator('.deleted-row', { hasText: 'Old meeting' });
  await expect(row.locator('.tag')).toHaveText('Event');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect.poll(async () => (await events(app, day)).length).toBe(1);
});

test('moving across the night the clocks go back keeps the clock time', async ({ page, app }) => {
  test.skip(new Date(2026, 9, 25).getTimezoneOffset() === new Date(2026, 9, 26).getTimezoneOffset(), 'this time zone has no clock change that night');
  await addEvent(app, { title: 'Swim', starts_at: '2026-10-25T11:00', ends_at: '2026-10-25T12:00' });
  await page.goto(`${app.url}/calendar/2026-10-25?view=day`);
  await page.getByRole('button', { name: /Swim/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await events(app, '2026-10-26'))[0]?.starts_at).toBe('2026-10-26T11:00');
});

test('quick presses each move the event: four times ↓ is an hour', async ({ page, app }) => {
  const day = localDay();
  await addEvent(app, { title: 'Focus', starts_at: `${day}T09:00`, ends_at: `${day}T10:00` });
  await page.goto(`${app.url}/calendar/${day}?view=day`);
  await page.getByRole('button', { name: /Focus/ }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await events(app, day))[0].starts_at).toBe(`${day}T10:00`);
  await expect(page.getByRole('button', { name: /Focus, 10:00/ })).toBeVisible();
});
