// The day in hours: events, blocks and tasks at their times (public/planner.js).
import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const post = (app, url, body) => fetch(`${app.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const patch = (app, id, body) => fetch(`${app.url}/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const task = async (app, text) => (await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === text);
const part = (page, name) => page.getByRole('region', { name, exact: true });
const top = (locator) => locator.evaluate((n) => n.getBoundingClientRect().top);

test('Place puts a task in the first free gap, at that time, below the event before it', async ({ page, app }) => {
  const today = localDay();
  await post(app, '/api/events', { title: 'Standup', starts_at: `${today}T08:00`, ends_at: `${today}T09:30` });
  await post(app, '/api/tasks', { text: 'Send Lena the proposal', estimate: 45 });
  await page.goto(`${app.url}/planner`);
  await page.getByRole('complementary', { name: 'Tasks to place' }).getByRole('button', { name: 'Place' }).click();
  const slot = part(page, 'Morning').locator('.plan-slot', { hasText: 'Send Lena the proposal' });
  await expect(slot).toContainText(new Date('2000-01-01T09:30').toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
  expect((await task(app, 'Send Lena the proposal')).plan_at).toBe('09:30');
  const event = part(page, 'Morning').locator('.plan-event', { hasText: 'Standup' });
  await expect(event).toContainText('locked');
  expect(await top(slot)).toBeGreaterThan(await top(event));
});

test('a task put in a part without a time shows in the first free time of its part', async ({ page, app }) => {
  const today = localDay();
  await post(app, '/api/events', { title: 'Lunch with Jonas', starts_at: `${today}T14:00`, ends_at: `${today}T15:00` });
  const made = await post(app, '/api/tasks', { text: 'Renew the train pass', estimate: 30, due: today });
  await patch(app, made.id, { plan_part: 'afternoon' });
  await page.goto(`${app.url}/planner`);
  const slot = part(page, 'Afternoon').locator('.plan-slot', { hasText: 'Renew the train pass' });
  await expect(slot).toHaveAttribute('data-at', String(15 * 60)); // after the lunch
  expect((await task(app, 'Renew the train pass')).plan_at).toBe(''); // shown there, kept only when moved
});

test('↑ and ↓ move a task 15 minutes each, quick presses in turn, and the time is kept', async ({ page, app }) => {
  const made = await post(app, '/api/tasks', { text: 'Draft the workshop agenda', estimate: 60, due: localDay() });
  await patch(app, made.id, { plan_part: 'morning', plan_at: '10:00' });
  await page.goto(`${app.url}/planner`);
  const slot = page.locator('.plan-slot', { hasText: 'Draft the workshop agenda' });
  await slot.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await task(app, 'Draft the workshop agenda')).plan_at).toBe('10:30');
  await expect(page.locator('.plan-slot', { hasText: 'Draft the workshop agenda' })).toHaveAttribute('data-at', String(10 * 60 + 30));
  await expect(page.locator('.plan-slot', { hasText: 'Draft the workshop agenda' })).toBeFocused();
});

test('dragged onto the hours, a task goes to that time and that part', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'dragging is a computer’s gesture');
  await post(app, '/api/tasks', { text: 'Call the dentist', estimate: 15 });
  await page.goto(`${app.url}/planner`);
  const hours = part(page, 'Afternoon').locator('.plan-hours');
  const box = await hours.boundingBox();
  const hour = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--plan-hour-height')));
  await page.locator('.tray-row', { hasText: 'Call the dentist' }).dragTo(hours, { targetPosition: { x: box.width / 2, y: hour * 1 + 2 } }); // an hour into the afternoon
  await expect.poll(async () => (await task(app, 'Call the dentist')).plan_at).toBe('15:00');
  expect((await task(app, 'Call the dentist')).plan_part).toBe('afternoon');
  await expect(part(page, 'Afternoon').locator('.plan-slot', { hasText: 'Call the dentist' })).toBeVisible();
});

test('two things at the same time share the width; an event past the split goes on in the Afternoon', async ({ page, app }) => {
  const today = localDay();
  await post(app, '/api/events', { title: 'Workshop', starts_at: `${today}T13:00`, ends_at: `${today}T15:00` });
  const made = await post(app, '/api/tasks', { text: 'Pay the invoice', estimate: 30, due: today });
  await patch(app, made.id, { plan_part: 'morning', plan_at: '13:00' });
  await page.goto(`${app.url}/planner`);
  const event = part(page, 'Morning').locator('.plan-event', { hasText: 'Workshop' });
  const slot = part(page, 'Morning').locator('.plan-slot', { hasText: 'Pay the invoice' });
  const [e, s] = [await event.boundingBox(), await slot.boundingBox()];
  expect(Math.abs(e.y - s.y)).toBeLessThan(2);
  expect(e.x + e.width).toBeLessThanOrEqual(s.x + 1); // side by side
  await expect(part(page, 'Afternoon').locator('.plan-event-more')).toContainText('Workshop');
  await expect(part(page, 'Afternoon').locator('.plan-event-more')).toContainText('(continued)');
});

test('your own events are filled in My events’ colour; today has a line for now', async ({ page, app }) => {
  const today = localDay();
  const now = new Date();
  await post(app, '/api/events', { title: 'Dentist', starts_at: `${today}T09:00`, ends_at: `${today}T10:00` });
  await page.goto(`${app.url}/planner`);
  const event = page.locator('.plan-event', { hasText: 'Dentist' });
  const surface = await page.evaluate(() => { const p = document.createElement('i'); p.style.background = 'var(--cal-1-fill)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; });
  expect(await event.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(surface);
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes >= 8 * 60 && minutes < 18 * 60) await expect(page.locator('.plan-now')).toHaveCount(1);
  else await expect(page.locator('.plan-now')).toHaveCount(0);
});

test('on every screen a task on the hours keeps its × to take it out of the day', async ({ page, app }) => {
  const made = await post(app, '/api/tasks', { text: 'Draft the workshop agenda for the whole team', estimate: 30, flag: 'must', due: localDay() });
  await patch(app, made.id, { plan_part: 'morning', plan_at: '10:00' });
  await page.goto(`${app.url}/planner`);
  const slot = page.locator('.plan-slot', { hasText: 'Draft the workshop agenda' });
  const out = slot.getByRole('button', { name: /out of the day/ });
  const [s, o] = [await slot.boundingBox(), await out.boundingBox()];
  expect(o.y + o.height).toBeLessThanOrEqual(s.y + s.height + 1); // inside the slot, not cut off
  await out.click();
  await expect(page.locator('.plan-slot', { hasText: 'Draft the workshop agenda' })).toHaveCount(0);
});

test('a short event keeps its name in view, beside its time; a long one has the name above the time', async ({ page, app }) => {
  const today = localDay();
  await post(app, '/api/events', { title: 'Team call', starts_at: `${today}T10:00`, ends_at: `${today}T10:30` });
  await post(app, '/api/events', { title: 'Workshop prep', starts_at: `${today}T11:00`, ends_at: `${today}T12:30` });
  await page.goto(`${app.url}/planner`);
  // The name is drawn: it has height, and it sits inside its block (not cut off).
  const drawn = (title) => part(page, 'Morning').locator('.plan-event', { hasText: title }).evaluate((block) => {
    const name = block.querySelector('.plan-event-title').getBoundingClientRect();
    const time = block.querySelector('.plan-time').getBoundingClientRect();
    const box = block.getBoundingClientRect();
    return { height: name.height, inside: name.top >= box.top && name.bottom <= box.bottom + 1, sameLine: Math.abs(name.top - time.top) < name.height };
  });
  expect(await drawn('Team call')).toEqual({ height: expect.any(Number), inside: true, sameLine: true });
  expect((await drawn('Team call')).height).toBeGreaterThan(0);
  const long = await drawn('Workshop prep');
  expect([long.height > 0, long.inside, long.sameLine]).toEqual([true, true, false]);
});
