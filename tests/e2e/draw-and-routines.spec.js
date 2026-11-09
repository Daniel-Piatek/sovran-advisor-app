// Calendar in depth, lesson 6: draw an event in the Calendar's hours, and routines you drag into a day of the Planner.

import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const send = (app, method, url, body) => fetch(`${app.url}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const events = (app) => fetch(`${app.url}/api/events?from=2000-01-01&to=2100-01-01`).then((r) => r.json());

test('press on empty time and pull down: a draft as long as you drew, a field for its name, Enter makes it, Esc lets it go', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'drawing is for a pointer');
  await page.goto(`${app.url}/calendar?view=day`);
  const column = page.locator('.cal-column');
  await column.scrollIntoViewIfNeeded();
  const hour = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-height')) || 48);
  // Bring 14:00 to 15:30 into view.
  await page.evaluate((h) => { document.querySelector('.cal-body').scrollTop = 12 * h; }, hour);
  const box = await column.boundingBox();
  const at = (minutes) => box.y + (minutes / 60) * hour;
  await page.mouse.move(box.x + 30, at(14 * 60));
  await page.mouse.down();
  await page.mouse.move(box.x + 30, at(14.75 * 60), { steps: 4 });
  await page.mouse.move(box.x + 30, at(15.5 * 60), { steps: 4 });
  await page.mouse.up();

  const draft = page.getByLabel(/New event from 14:00 to 15:30/);
  await expect(draft).toBeVisible();
  const field = page.getByLabel('Name of the new event');
  await expect(field).toBeFocused();
  expect(await events(app)).toHaveLength(0); // nothing exists until Enter
  await field.fill('Call with the venue');
  await field.press('Enter');
  await expect(page.getByRole('button', { name: /Call with the venue, .* to / })).toBeVisible();
  const [made] = await events(app);
  expect([made.title, made.starts_at.slice(11), made.ends_at.slice(11)]).toEqual(['Call with the venue', '14:00', '15:30']);

  // Draw another and let it go with Escape: nothing is made.
  await page.evaluate((h) => { document.querySelector('.cal-body').scrollTop = 7 * h; }, hour);
  const box2 = await column.boundingBox();
  const at2 = (minutes) => box2.y + (minutes / 60) * hour;
  await page.mouse.move(box.x + 30, at2(9 * 60));
  await page.mouse.down();
  await page.mouse.move(box.x + 30, at2(9.5 * 60), { steps: 4 });
  await page.mouse.up();
  await page.getByLabel('Name of the new event').press('Escape');
  await expect(page.locator('.cal-draft')).toHaveCount(0);
  expect(await events(app)).toHaveLength(1);

  // A plain click still opens the dialog with a one-hour draft.
  await page.mouse.click(box.x + 30, at2(11 * 60 + 10));
  await expect(page.getByRole('dialog', { name: 'Event' })).toBeVisible();
});

test('routines: add one, drag it into the day, it is a dotted task there and never on the Calendar; remove with Undo', async ({ page, app }) => {
  await send(app, 'PATCH', '/api/settings', { day_start: '08:00', day_end: '18:00', split: '14:00' });
  await page.goto(`${app.url}/planner`);
  const strip = page.getByRole('region', { name: 'Routines' });
  await strip.getByLabel('Routine name').fill('Run');
  await strip.getByLabel('Routine length in minutes').fill('45');
  await strip.getByRole('button', { name: 'Add routine' }).click();
  const chip = strip.locator('.template-chip', { hasText: 'Run' });
  await expect(chip).toContainText('45 min');

  // Dragged into an empty morning of the day.
  const morning = page.getByRole('region', { name: 'Morning', exact: true });
  await chip.dragTo(morning, { targetPosition: { x: 240, y: 60 } });
  const slot = page.locator('.plan-slot.is-routine');
  await expect(slot).toContainText('Run');
  // A task of its own, marked with its routine, with the routine's length; the routine itself is still there.
  const task = (await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Run');
  expect([task.estimate, task.due, task.plan_part]).toEqual([45, localDay(), 'morning']);
  expect(task.template_id).toBeTruthy();
  await expect(chip).toBeVisible();
  // Not on the Calendar.
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(0);
  expect(await events(app)).toHaveLength(0);

  // In the Order it is dotted too.
  await page.goto(`${app.url}/planner?lens=order`);
  await expect(page.locator('.order-day .task-block.is-routine')).toContainText('Run');

  // Remove, and Undo.
  await page.goto(`${app.url}/planner`);
  await strip.getByRole('button', { name: 'Remove the routine Run' }).click();
  await expect(strip.locator('.template-chip')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(strip.locator('.template-chip', { hasText: 'Run' })).toBeVisible();
});

test('a routine dragged into the hours of three days is placed on that day', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'dragging is for a pointer');
  await send(app, 'PATCH', '/api/settings', { day_start: '08:00', day_end: '18:00', split: '14:00' });
  await send(app, 'POST', '/api/templates', { title: 'Deep work', minutes: 120 });
  await page.goto(`${app.url}/planner?range=3`);
  const chip = page.locator('.template-chip', { hasText: 'Deep work' });
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const column = page.locator(`.hour-grid-day[data-day="${localDay(tomorrow)}"]`);
  await chip.dragTo(column, { targetPosition: { x: 30, y: 60 } });
  await expect(column.locator('.task-block.is-routine')).toContainText('Deep work');
  const task = (await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Deep work');
  expect([task.due, task.estimate]).toEqual([localDay(tomorrow), 120]);
});

test('routines are only there with Calendar in depth on; the Library shows the Template chip', async ({ page, app }) => {
  await send(app, 'PATCH', '/api/modules', { id: 'calendar-plus', on: false });
  await page.goto(`${app.url}/planner`);
  await expect(page.getByRole('region', { name: 'Routines' })).toBeHidden();
  await send(app, 'PATCH', '/api/modules', { id: 'calendar-plus', on: true });
  await page.goto(`${app.url}/library`);
  await expect(page.locator('.template-chip').first()).toContainText('Run');
});
