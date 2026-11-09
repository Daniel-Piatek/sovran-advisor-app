// Calendar in depth, lesson 2: the Planner's day as its order, and one, three or seven days in hours,
// both drawn from the same day, and neither of them on the Calendar.

import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const send = (app, method, url, body) => fetch(`${app.url}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

// Today: a call at 10:00 and lunch at 12:00, a day that ends at 15:30, and three one-hour tasks after lunch,
// so the gap after lunch (13:00 to 15:30) is thirty minutes too short.
async function aDayThatIsTooFull(app) {
  const today = localDay();
  await send(app, 'PATCH', '/api/settings', { day_start: '09:00', day_end: '15:30', split: '14:00' });
  await send(app, 'POST', '/api/events', { title: 'Call with Lena', starts_at: `${today}T10:00`, ends_at: `${today}T10:30` });
  await send(app, 'POST', '/api/events', { title: 'Lunch', starts_at: `${today}T12:00`, ends_at: `${today}T13:00` });
  for (const [i, text] of ['Draft the agenda', 'Send the offer', 'Plan the venue'].entries()) {
    const task = await send(app, 'POST', '/api/tasks', { text, estimate: 60 });
    await send(app, 'PATCH', `/api/tasks/${task.id}`, { due: today, plan_part: 'afternoon', plan_at: `${13 + i}:00` });
  }
}

test('the Order lists the events as anchors and the tasks in each gap, and says the gap is over by 30 minutes', async ({ page, app }) => {
  await aDayThatIsTooFull(app);
  await page.goto(`${app.url}/planner`);
  await page.getByRole('group', { name: 'Lens' }).getByRole('button', { name: 'Order' }).click();
  const order = page.getByRole('list', { name: 'The day in order' });
  await expect(order.locator('.order-anchor')).toHaveText([/Call with Lena/, /Lunch/]);
  // After lunch: the three tasks in their order, and the gap says how much it is over.
  const afterLunch = order.locator('.order-gap').last();
  await expect(afterLunch.locator('.task-block')).toHaveText([/Draft the agenda/, /Send the offer/, /Plan the venue/]);
  await expect(afterLunch).toContainText('Over by 30 min');
  await expect(afterLunch).toHaveAttribute('data-over', 'true');
  await expect(page).toHaveURL(/lens=order/);
});

test('Hours: one, three or seven days; the tasks after lunch share the gap, never past it, and the first is the first block after Lunch', async ({ page, app }) => {
  await aDayThatIsTooFull(app);
  await page.goto(`${app.url}/planner`);
  const hours = page.getByRole('group', { name: 'Days in hours' });
  await hours.getByRole('button', { name: '3 days' }).click();
  const grid = page.getByRole('group', { name: 'The days in hours' });
  await expect(grid.locator('.hour-grid-head')).toHaveCount(3);

  const today = grid.locator(`.hour-grid-day[data-day="${localDay()}"]`);
  const blocks = today.locator('.task-block');
  await expect(blocks).toHaveCount(3);
  const lunch = await today.locator('.grid-event', { hasText: 'Lunch' }).boundingBox();
  const boxes = [];
  for (let i = 0; i < 3; i += 1) boxes.push(await blocks.nth(i).boundingBox());
  const dayBox = await today.boundingBox();
  const oneHour = (dayBox.height / (6.5 + 0)) * 1; // the grid is 9:00 to 15:30 here: 6.5 hours
  // The first block starts at the end of Lunch; each is shorter than the hour it asked for, and together they stop at the day's end.
  expect(Math.abs(boxes[0].y - (lunch.y + lunch.height + 2))).toBeLessThan(4);
  for (const box of boxes) expect(box.height).toBeLessThan(oneHour);
  expect(boxes[2].y + boxes[2].height).toBeLessThanOrEqual(dayBox.y + dayBox.height + 1);
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y);

  await hours.getByRole('button', { name: 'Week' }).click();
  await expect(grid.locator('.hour-grid-head')).toHaveCount(7);
  await expect(page).toHaveURL(/range=7/);
  await hours.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Afternoon', exact: true })).toBeVisible();

  // None of it is on the Calendar: only the two events are.
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(2);
});

test('the lens and the days in hours are only there with Calendar in depth on', async ({ page, app }) => {
  await page.goto(`${app.url}/planner`);
  await expect(page.getByRole('group', { name: 'Lens' })).toBeVisible();
  await send(app, 'PATCH', '/api/modules', { id: 'calendar-plus', on: false });
  await page.goto(`${app.url}/planner?lens=order`);
  await expect(page.getByRole('group', { name: 'Lens' })).toBeHidden();
  await expect(page.getByRole('list', { name: 'The day in order' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Afternoon', exact: true })).toBeVisible();
});

test('the Library shows the Task block and the Hour grid', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.locator('.task-block.is-squeezed').first()).toBeVisible();
  await expect(page.locator('.task-block.is-done')).toHaveCount(1);
  await expect(page.locator('.hour-grid')).toHaveCount(1);
  await expect(page.locator('.hour-grid .hour-grid-head')).toHaveText(['Tue', 'Wed']);
});

test('V switches the lens and V again comes back to the same days', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'V is a keyboard key');
  await aDayThatIsTooFull(app);
  await page.goto(`${app.url}/planner?range=3`);
  const lens = page.getByRole('group', { name: 'Lens' });
  await expect(lens.getByRole('button', { name: 'Hours' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hour-grid-head')).toHaveCount(3);
  await page.keyboard.press('v');
  await expect(lens.getByRole('button', { name: 'Order' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('list', { name: 'The day in order' })).toBeVisible();
  await page.keyboard.press('v');
  await expect(lens.getByRole('button', { name: 'Hours' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hour-grid-head')).toHaveCount(3);
  await expect(page).toHaveURL(/range=3/);
});

test('dragging a task into another gap lights the gap with the event it follows, and writes only its place', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'dragging in the hours is for a computer');
  await aDayThatIsTooFull(app);
  await page.goto(`${app.url}/planner?range=3`);
  const grid = page.getByRole('group', { name: 'The days in hours' });
  const column = grid.locator(`.hour-grid-day[data-day="${localDay()}"]`);
  const before = (await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Plan the venue');
  expect(before.estimate).toBe(60);

  // Over the gap after the call (10:30 to 12:00) the gap names the event it would follow.
  const block = column.locator('.task-block', { hasText: 'Plan the venue' });
  const target = { x: 40, y: Math.round(((10.75 - 9) * 40)) }; // 10:45 in a grid that starts at 9:00
  const from = await block.boundingBox();
  const colBox = await column.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(colBox.x + 40, colBox.y + target.y - 20, { steps: 4 });
  await page.mouse.move(colBox.x + 40, colBox.y + target.y, { steps: 4 });
  const lit = column.locator('.grid-gap');
  await expect(lit).toBeVisible();
  await expect(lit).toContainText('After Call with Lena');
  await page.mouse.up();
  await expect(lit).toBeHidden();
  await expect(column.locator('.task-block')).toHaveCount(3);

  // After the drop: the task sits after the call, the gap after lunch is no longer over, and its estimate is as it was.
  await page.keyboard.press('v');
  const order = page.getByRole('list', { name: 'The day in order' });
  await expect(order.locator('.order-gap').nth(1).locator('.task-block')).toHaveText([/Plan the venue/]);
  await expect(order.locator('.order-gap').last()).not.toContainText('Over by');
  const after = (await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Plan the venue');
  expect(after.estimate).toBe(60);
  expect(after.due).toBe(localDay());
  // None of it is on the Calendar.
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(2);
});

test('the Library shows the Lens switch', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  const lens = page.getByRole('group', { name: 'Lens' });
  await expect(lens.getByRole('button', { name: 'Hours' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Days in hours' }).getByRole('button', { name: '3 days' })).toHaveAttribute('aria-pressed', 'true');
});

const plannedMinutes = async (page) => {
  const text = await page.locator('.budget-words').textContent();
  const [, h = 0, m = 0] = /(?:(\d+) h)? ?(?:(\d+)(?: min)?)? planned/.exec(text) ?? [];
  return Number(h) * 60 + Number(m);
};

test('Pin to a time: a task takes a time and a length of its own, shows solid with a pin, is counted in full and is never on the Calendar', async ({ page, app }) => {
  await aDayThatIsTooFull(app);
  await page.goto(`${app.url}/planner?lens=order`);
  const order = page.getByRole('list', { name: 'The day in order' });
  await expect(order.locator('.order-gap').last()).toContainText('Over by 30 min');
  const before = await plannedMinutes(page);

  // Pin the agenda to 10:45 for an hour and a half.
  const agenda = order.locator('.task-block', { hasText: 'Draft the agenda' });
  await agenda.hover();
  await agenda.getByRole('button', { name: /Pin .* to a time/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Pin to a time' });
  await dialog.getByLabel('Start').fill('10:45');
  await dialog.getByLabel('Length in minutes').fill('90');
  await dialog.getByRole('button', { name: 'Pin', exact: true }).click();

  // A solid row with a pin, at its time, after the call; the afternoon is no longer over; the budget grew by the 30 minutes more it holds.
  const pinned = order.locator('.order-anchor.is-pin');
  await expect(pinned).toContainText('Draft the agenda');
  await expect(pinned).toContainText(/10:45 AM–12:15 PM/);
  await expect(order.locator('.order-gap').last()).not.toContainText('Over by');
  expect(await plannedMinutes(page)).toBe(before + 30);

  // Its checkbox still works.
  await pinned.getByRole('checkbox').click();
  await expect(pinned).toHaveClass(/is-done/);
  await pinned.getByRole('checkbox').click();
  await expect(pinned).not.toHaveClass(/is-done/);

  // In the hours it is a solid block with a pin; in the day it is a task slot marked Pinned.
  await page.keyboard.press('v');
  await expect(page.locator('.hour-grid-day .grid-event.is-pin')).toHaveCount(0); // one day: the Planner's own day
  await page.getByRole('group', { name: 'Days in hours' }).getByRole('button', { name: '3 days' }).click();
  await expect(page.locator('.hour-grid-day .grid-event.is-pin')).toContainText('Draft the agenda');
  await page.getByRole('group', { name: 'Days in hours' }).getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.locator('.plan-slot.is-pinned')).toContainText('Draft the agenda');

  // Still a task, with its own estimate; not on the Calendar.
  const task = (await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Draft the agenda');
  expect([task.estimate, task.pin_at, task.pin_minutes, task.done]).toEqual([60, '10:45', 90, false]);
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(2);

  // Unpin gives it back to its gap.
  await page.goto(`${app.url}/planner?lens=order`);
  await order.locator('.order-anchor.is-pin').getByRole('button', { name: /Change the pin/ }).click();
  await page.getByRole('dialog', { name: 'Pin to a time' }).getByRole('button', { name: 'Unpin' }).click();
  await expect(order.locator('.order-anchor.is-pin')).toHaveCount(0);
});
