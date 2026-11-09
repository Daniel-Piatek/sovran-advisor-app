import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };
const post = (app, url, body) => fetch(`${app.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const part = (page, name) => page.getByRole('region', { name, exact: true });
// The day's own tasks without a place yet: their group at the top of Tasks to place.
const unplaced = (page) => page.locator('.tray-rows.is-day .tray-row');
// Let go where a person can see it: near the top of a part (its hours run past the screen).
const nearTop = { targetPosition: { x: 240, y: 60 } };
const freeOf = async (page, name) => {
  const text = await part(page, name).locator('.plan-part-title .plan-free').textContent();
  const [, h = 0, m = 0] = /· (?:(\d+) h)? ?(?:(\d+)(?: min)?)? free/.exec(text) ?? [];
  return Number(h) * 60 + Number(m);
};

test('a task dragged from the Tray to the Afternoon gets the day, and the Afternoon’s free minutes drop by its estimate', async ({ page, app }) => {
  await post(app, '/api/tasks', { text: 'Draft the offer', estimate: 45 });
  await page.goto(`${app.url}/planner`);
  const tray = page.getByRole('complementary', { name: 'Tasks to place' });
  await expect(tray.getByRole('list', { name: 'No date' }).locator('.tray-row')).toHaveText([/Draft the offer/]);
  const before = await freeOf(page, 'Afternoon');
  await tray.locator('.tray-row', { hasText: 'Draft the offer' }).dragTo(part(page, 'Afternoon'), nearTop);
  await expect(part(page, 'Afternoon').locator('.plan-slot')).toHaveText([/Draft the offer/]);
  expect(await freeOf(page, 'Afternoon')).toBe(before - 45);
  await expect(tray.getByText('Nothing waits to be placed.')).toBeVisible();

  // Its day is on the Tasks page too, and it is not on the Calendar.
  const [task] = await (await fetch(`${app.url}/api/tasks`)).json();
  expect([task.due, task.plan_part]).toEqual([localDay(), 'afternoon']);
  await page.goto(`${app.url}/tasks`);
  await expect(page.getByRole('region', { name: 'Today', exact: true }).locator('.task-words')).toContainText(['Draft the offer']);
  await page.goto(`${app.url}/calendar?view=day`);
  await expect(page.locator('.cal-event')).toHaveCount(0);
});

test('Place puts a task where there is room; × takes it back; events are locked and count against the free time', async ({ page, app }) => {
  const today = localDay();
  await post(app, '/api/events', { title: 'Standup', starts_at: `${today}T09:00`, ends_at: `${today}T09:30` });
  await post(app, '/api/tasks', { text: 'Pay the invoice', estimate: 10 });
  await post(app, '/api/tasks', { text: 'Sort the attic' }); // no estimate: 30 min
  await page.goto(`${app.url}/planner`);
  await expect(part(page, 'Morning').locator('.plan-event')).toHaveText([/Standup.*locked/]);
  expect(await freeOf(page, 'Morning')).toBe(6 * 60 - 30); // 8:00–14:00 less the standup

  const tray = page.getByRole('complementary', { name: 'Tasks to place' });
  await tray.locator('.tray-row', { hasText: 'Pay the invoice' }).getByRole('button', { name: 'Place' }).click();
  await expect(part(page, 'Morning').locator('.plan-slot')).toHaveText([/Pay the invoice/]);
  await tray.locator('.tray-row', { hasText: 'Sort the attic' }).getByRole('button', { name: 'Place' }).click();
  await expect(part(page, 'Morning').locator('.plan-slot').last()).toContainText('30 min?');
  expect(await freeOf(page, 'Morning')).toBe(6 * 60 - 30 - 10 - 30);

  await part(page, 'Morning').getByRole('button', { name: 'Take “Pay the invoice” out of the day' }).click();
  await expect(tray.locator('.tray-row', { hasText: 'Pay the invoice' })).toBeVisible();
  expect((await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Pay the invoice').due).toBe('');

  // Ticking it here ticks it.
  await part(page, 'Morning').locator('.plan-slot', { hasText: 'Sort the attic' }).getByRole('checkbox').click();
  await expect(part(page, 'Morning').locator('.plan-slot', { hasText: 'Sort the attic' })).toHaveAttribute('data-checked', 'true');
});

test('a task moves from the Morning to the Afternoon by dragging, and back to the Tray', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'dragging is a computer’s gesture: on a phone the day’s hours run off the screen, and a task is placed with Place');
  await post(app, '/api/tasks', { text: 'Call the bank', estimate: 30, due: localDay() });
  await page.goto(`${app.url}/planner`);
  const unplaced = page.getByRole('complementary', { name: 'Tasks to place' }).getByRole('list', { name: 'Today' });
  await expect(unplaced.locator('.tray-row')).toHaveText([/Call the bank/]);
  await unplaced.locator('.tray-row').dragTo(part(page, 'Morning'), nearTop);
  await expect(part(page, 'Morning').locator('.plan-slot')).toHaveText([/Call the bank/]);
  await part(page, 'Morning').locator('.plan-slot').dragTo(part(page, 'Afternoon'), nearTop);
  await expect(part(page, 'Afternoon').locator('.plan-slot')).toHaveText([/Call the bank/]);
  await part(page, 'Afternoon').locator('.plan-slot').dragTo(page.getByRole('complementary', { name: 'Tasks to place' }));
  await expect(page.getByRole('complementary', { name: 'Tasks to place' }).locator('.tray-row')).toHaveText([/Call the bank/]);
});

test('another day: its own tasks, and the way back to today', async ({ page, app }) => {
  await post(app, '/api/tasks', { text: 'Dentist prep', estimate: 15, due: inDays(1) });
  await page.goto(`${app.url}/planner`);
  await page.getByRole('button', { name: 'The day after' }).click();
  await expect(page).toHaveURL(new RegExp(`/planner/${inDays(1)}$`));
  await expect(unplaced(page)).toHaveText([/Dentist prep/]);
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(unplaced(page)).toHaveCount(0);
});

const budget = (page) => page.locator('.budget');

test('planned more than fits: the day says it is over budget, by how much, and what could move', async ({ page, app }) => {
  const today = localDay();
  await post(app, '/api/events', { title: 'Workshop', starts_at: `${today}T09:00`, ends_at: `${today}T12:00` });
  for (const [text, estimate, flag] of [['Write the offer', 180, 'must'], ['Sort the attic', 120, ''], ['Tidy the studio', 60, 'like']]) {
    await post(app, '/api/tasks', { text, estimate, flag, due: today });
  }
  await page.goto(`${app.url}/planner`);
  // 3 h of meetings + 6 h of tasks = 9 h, against 5 h work + 3 h buffer = 8 h.
  await expect(budget(page)).toHaveClass(/is-over/);
  await expect(budget(page)).toContainText('Over by 1 h · 9 h planned of 8 h');
  const colour = await budget(page).evaluate((node) => getComputedStyle(node).color);
  const warning = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-warning)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  expect(colour).toBe(warning);
  // It suggests a task that isn't a Must: the unflagged one first.
  await budget(page).getByRole('button', { name: 'Move “Sort the attic” to tomorrow' }).click();
  await expect(budget(page)).not.toHaveClass(/is-over/);
  await expect(budget(page)).toHaveText('7 h planned of 8 h');
  expect((await (await fetch(`${app.url}/api/tasks`)).json()).find((t) => t.text === 'Sort the attic').due).toBe(inDays(1));
});

test('from the ninth thing it says that is a lot; it never stops you', async ({ page, app }) => {
  for (let i = 1; i <= 9; i++) await post(app, '/api/tasks', { text: `Small thing ${i}`, estimate: 5, due: localDay() });
  await page.goto(`${app.url}/planner`);
  await expect(budget(page)).toContainText('9 things: that is a lot for one day');
  await post(app, '/api/tasks', { text: 'One more', estimate: 5 });
  await page.reload();
  await page.getByRole('complementary', { name: 'Tasks to place' }).getByRole('list', { name: 'No date' }).getByRole('button', { name: 'Place' }).click();
  await expect(page.locator('.plan-slot')).toHaveCount(1);
  await expect(unplaced(page)).toHaveCount(9);
  await expect(budget(page)).toContainText('10 things');
});

test('Planner settings change the budget and the day, and are kept', async ({ page, app }) => {
  await post(app, '/api/tasks', { text: 'Write', estimate: 60, due: localDay() });
  await page.goto(`${app.url}/planner`);
  await expect(budget(page)).toHaveText('1 h planned of 8 h');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('region', { name: 'Planner settings' });
  await settings.getByLabel('Planned work').fill('6');
  await settings.getByLabel('Planned work').press('Tab');
  await expect(budget(page)).toHaveText('1 h planned of 9 h');
  await settings.getByLabel('Afternoon from').fill('13:00');
  await settings.getByLabel('Afternoon from').press('Tab');
  await expect(part(page, 'Morning').locator('.plan-free')).toContainText('1:00');
  await settings.getByLabel('A missed task').selectOption('ask');
  await expect.poll(async () => (await (await fetch(`${app.url}/api/settings`)).json()).missed).toBe('ask');
  await page.reload();
  await expect(budget(page)).toHaveText('1 h planned of 9 h');
});

const block = (page, kind) => page.getByRole('group', { name: `${kind} block` });

test('a 90-minute Deep Work block this morning, a task dropped in: it shows the task and the minutes left', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'dragging is a computer’s gesture: on a phone the day’s hours run off the screen, and a task is placed with Place');
  await post(app, '/api/tasks', { text: 'Write the outline', estimate: 60 });
  await page.goto(`${app.url}/planner`);
  await expect(page.locator('.tray-row')).toHaveCount(1);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('b');
  const dialog = page.getByRole('dialog', { name: 'Time block' });
  await dialog.getByLabel('Kind').selectOption({ label: 'Deep Work' });
  await dialog.getByLabel('From').fill('09:00');
  await dialog.getByLabel('To').fill('10:30');
  await dialog.getByRole('button', { name: 'Add block' }).click();
  const deep = part(page, 'Morning').getByRole('group', { name: 'Deep Work block' });
  await expect(deep).toContainText('1 h 30 left');
  const before = await freeOf(page, 'Morning');

  await page.locator('.tray-row', { hasText: 'Write the outline' }).dragTo(deep);
  await expect(deep.locator('.plan-slot')).toHaveText([/Write the outline/]);
  await expect(deep).toContainText('30 min left');
  expect(await freeOf(page, 'Morning')).toBe(before); // the block already took its time
  const [task] = await (await fetch(`${app.url}/api/tasks`)).json();
  expect([task.due, Boolean(task.block_id)]).toEqual([localDay(), true]);
  // On the hours, the block sits at its time.
  await expect(part(page, 'Morning').locator('.plan-block.on-grid')).toHaveCount(1);
});

test('a short block gets a word of warning; a block changes, and is deleted with Undo', async ({ page, app }) => {
  await post(app, '/api/blocks', { day: localDay(), starts_at: '15:00', ends_at: '15:30', kind: 'shallow' });
  await page.goto(`${app.url}/planner`);
  const shallow = block(page, 'Shallow');
  await expect(shallow).toContainText('under 45 min');
  await shallow.getByRole('button', { name: 'Shallow' }).click();
  const dialog = page.getByRole('dialog', { name: 'Time block' });
  await dialog.getByLabel('To').fill('16:15');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(shallow).not.toContainText('under 45 min');
  await shallow.getByRole('button', { name: 'Shallow' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(shallow).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(shallow).toHaveCount(1);
});

test('more than ten blocks: the day says so', async ({ page, app }) => {
  for (let h = 6; h <= 16; h++) await post(app, '/api/blocks', { day: localDay(), starts_at: `${String(h).padStart(2, '0')}:00`, ends_at: `${String(h).padStart(2, '0')}:50`, kind: 'batch' });
  await page.goto(`${app.url}/planner`);
  await expect(budget(page)).toContainText('11 blocks: more than 10');
  await expect(budget(page)).toHaveClass(/is-over/);
});

test('a task planned for yesterday and left open sits in Missed with yesterday’s date, not on today; t brings it back', async ({ page, app }) => {
  await post(app, '/api/tasks', { text: 'Renew the pass', estimate: 20, due: inDays(-1) });
  await page.goto(`${app.url}/planner`);
  const missed = page.getByRole('list', { name: 'Missed' });
  await expect(missed.locator('.tray-row')).toHaveText([/Renew the pass.*Yesterday/]);
  await expect(unplaced(page)).toHaveCount(0);
  await missed.locator('.tray-row').focus();
  await page.keyboard.press('t');
  await expect(unplaced(page)).toHaveText([/Renew the pass/]);
  await expect(page.getByRole('list', { name: 'Missed' })).toHaveCount(0);
  expect((await (await fetch(`${app.url}/api/tasks`)).json())[0].due).toBe(localDay());
});

test('the Missed setting: carry them to today by themselves, or ask', async ({ page, app }) => {
  await post(app, '/api/tasks', { text: 'Old one', due: inDays(-2) });
  await post(app, '/api/tasks', { text: 'Older one', due: inDays(-5) });
  await fetch(`${app.url}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missed: 'ask' }) });
  await page.goto(`${app.url}/planner`);
  await expect(page.getByText('2 tasks from earlier days are not done.')).toBeVisible();
  await page.getByRole('button', { name: 'Keep them in Missed' }).click();
  await expect(page.getByText('2 tasks from earlier days are not done.')).toBeHidden();
  await expect(page.getByRole('list', { name: 'Missed' }).locator('.tray-row')).toHaveCount(2);

  await fetch(`${app.url}/api/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ missed: 'carry' }) });
  await page.reload();
  await expect(page.getByText('2 tasks from earlier days carried to today.')).toBeVisible();
  await expect(unplaced(page)).toHaveCount(2);
});

// Between a phone and a large screen (a narrower window, a tablet) a task's words keep a
// readable width: they were once squeezed to one letter a line at 800 px, beside the Tray.
test('at every width from small window to large screen, a task row keeps its words readable', async ({ page, app, isMobile }) => {
  test.skip(isMobile, 'the phone has its own layout, tested elsewhere');
  const today = localDay();
  for (const [text, flag] of [['test call the dentist about the crown', 'must'], ['Plan out the next two weeks on the planner in the new app', 'like']]) {
    const made = await post(app, '/api/tasks', { text, due: today, flag });
    await fetch(`${app.url}/api/tasks/${made.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_part: 'morning' }) });
  }
  await post(app, '/api/tasks', { text: 'Waiting in the Tray for a day', flag: 'must' });
  for (const width of [700, 800, 900, 910, 1000, 1100, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${app.url}/planner`);
    await expect(page.locator('.plan-slot')).toHaveCount(2);
    for (const words of await page.locator('.plan-slot-text, .tray-text').all()) {
      const box = await words.boundingBox();
      const line = await words.evaluate((node) => parseFloat(getComputedStyle(node).lineHeight) || 20);
      expect(box.width, `words at ${width} px wide`).toBeGreaterThanOrEqual(120);
      expect(box.height, `lines at ${width} px wide`).toBeLessThanOrEqual(line * 3 + 1);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `no sideways scroll at ${width} px`).toBeLessThanOrEqual(0);
    // The week strip's days never run into each other.
    for (const name of await page.locator('.day-strip-name').all()) {
      const fits = await name.evaluate((n) => n.getBoundingClientRect().right <= n.closest('.day-strip-day').getBoundingClientRect().right + 1);
      expect(fits, `a day's name fits in its day at ${width} px`).toBe(true);
    }
  }
});
