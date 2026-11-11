// Every calendar action is measured and kept under 100 ms (Calendar in depth 10): a full week of about sixty items, each action done several
// times through the real page, the timings read from the page's own record (public/timings.js, what Settings › Calendar shows).
// The test fails when the typical (median) time of an action reaches 100 ms; the slowest is reported too.

import { test, expect } from './fixtures.js';

const BUDGET = 100;
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const send = (app, method, url, body) => fetch(`${app.url}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const timings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('calendar.timings') ?? '[]'));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// A full week: from today, each day with five events and three placed tasks (56 items), and a few tasks waiting in the Tray.
async function aFullWeek(app) {
  // Seven days from today, not from Monday: a day already past would put its tasks in the Tray's Missed list (2026-11-11: the test failed on a Wednesday).
  const monday = new Date();
  await send(app, 'PATCH', '/api/settings', { day_start: '08:00', day_end: '18:00', split: '13:00' });
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday); d.setDate(d.getDate() + i);
    const day = localDay(d);
    for (const [j, [from, to]] of [['08:30', '09:00'], ['10:00', '10:45'], ['12:00', '13:00'], ['14:30', '15:00'], ['16:30', '17:30']].entries()) {
      await send(app, 'POST', '/api/events', { title: `Meeting ${i}-${j}`, starts_at: `${day}T${from}`, ends_at: `${day}T${to}` });
    }
    for (const [j, [part, at]] of [['morning', '09:15'], ['morning', '11:00'], ['afternoon', '15:15']].entries()) {
      const task = await send(app, 'POST', '/api/tasks', { text: `Task ${i}-${j}`, estimate: 30 });
      await send(app, 'PATCH', `/api/tasks/${task.id}`, { due: day, plan_part: part, plan_at: at });
    }
  }
  for (let k = 0; k < 6; k += 1) await send(app, 'POST', '/api/tasks', { text: `Waiting ${k}`, estimate: 15 });
}

test('with a full week on the page, every calendar action takes under 100 ms (the typical one), and Settings lists the timings', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'the timings are measured on the large screen, where a person drags and presses keys');
  await aFullWeek(app);

  // Switch the lens: Order and Hours, on the week in hours.
  await page.goto(`${app.url}/planner?range=7`);
  await page.evaluate(() => localStorage.removeItem('calendar.timings'));
  const lens = page.getByRole('group', { name: 'Lens' });
  await expect(page.locator('.hour-grid-head')).toHaveCount(7);
  for (let i = 0; i < 4; i += 1) {
    await lens.getByRole('button', { name: 'Order' }).click();
    await expect(page.getByRole('list', { name: 'The day in order' })).toBeVisible();
    await lens.getByRole('button', { name: 'Hours' }).click();
    await expect(page.locator('.hour-grid-head')).toHaveCount(7);
  }

  // Drop a task into the day in hours.
  await page.goto(`${app.url}/planner`);
  const hours = page.getByRole('region', { name: 'Afternoon', exact: true }).locator('.plan-hours');
  for (let i = 0; i < 4; i += 1) {
    const row = page.locator('.tray-row', { hasText: `Waiting ${i}` });
    await row.dragTo(hours, { targetPosition: { x: 200, y: 8 + i * 16 } });
    await expect(page.locator('.plan-slot', { hasText: `Waiting ${i}` })).toBeVisible();
  }

  // Make an event from a sentence, and move one with the keyboard.
  await page.goto(`${app.url}/calendar`);
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('ControlOrMeta+k');
    const field = page.getByLabel('The event, in words');
    await field.fill(`Lunch ${i} thu 18:${pad(i * 10)} 30m`);
    await field.press('Enter');
    await expect(page.getByRole('button', { name: new RegExp(`^Lunch ${i}, `) })).toBeVisible();
  }
  const event = page.getByRole('button', { name: /^Meeting 0-1, / });
  await event.focus();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await timings(page)).filter((t) => t.name === 'Move an event').length).toBe(i + 1);
  }

  const all = await timings(page);
  const report = {};
  for (const name of ['Switch lens', 'Drop a task', 'Make an event', 'Move an event']) {
    const ms = all.filter((t) => t.name === name).map((t) => t.ms);
    expect(ms.length, `${name} was measured`).toBeGreaterThanOrEqual(4);
    report[name] = { typical: median(ms), slowest: Math.max(...ms), times: ms.length };
    expect(median(ms), `${name}: typical ${median(ms)} ms, slowest ${Math.max(...ms)} ms (times: ${ms.join(', ')})`).toBeLessThan(BUDGET);
  }
  test.info().annotations.push({ type: 'timings', description: JSON.stringify(report) });

  // Settings › Calendar timings lists them, in words.
  await page.goto(`${app.url}/settings`);
  const part = page.getByRole('region', { name: 'Calendar timings' });
  await expect(part).toContainText('Switch lens');
  await expect(part.locator('[data-timing="Move an event"]')).toContainText(/usually \d+(\.\d+)? ms/);
  await expect(part).toContainText('The last actions');
});

test('the timings are kept as the last fifty, and Settings says so when an action was slow', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  await page.evaluate(() => localStorage.setItem('calendar.timings', JSON.stringify([
    ...Array.from({ length: 60 }, (_, i) => ({ name: 'Switch lens', ms: 20 + i, at: new Date().toISOString() })),
    { name: 'Move an event', ms: 130, at: new Date().toISOString() },
  ])));
  await page.reload();
  const part = page.getByRole('region', { name: 'Calendar timings' });
  await expect(part.locator('[data-timing="Move an event"]')).toContainText('over 100 ms at least once');
  await expect(part).toContainText('over 100 ms');
  // Recording keeps fifty.
  await page.goto(`${app.url}/planner`);
  await page.getByRole('group', { name: 'Lens' }).getByRole('button', { name: 'Order' }).click();
  await expect.poll(async () => (await timings(page)).at(-1)?.name).toBe('Switch lens');
  expect((await timings(page)).length).toBeLessThanOrEqual(50);
});
