import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };
const post = (app, url, body) => fetch(`${app.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const tasks = (app) => fetch(`${app.url}/api/tasks`).then((r) => r.json());
const highlight = (page) => page.getByRole('region', { name: 'Highlight' });

test('star a task and make it today’s Highlight: it is at the top; pick another, then z: the first is back', async ({ page, app }) => {
  for (const text of ['Pay the invoice', 'Write the outline', 'Call the bank']) {
    const made = await post(app, '/api/tasks', { text, estimate: 30, due: localDay() });
    await fetch(`${app.url}/api/tasks/${made.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_part: 'morning' }) });
  }
  await page.goto(`${app.url}/planner`);
  const outline = page.locator('.plan-slot', { hasText: 'Write the outline' });
  await outline.getByRole('button', { name: 'Make “Write the outline” a Weekly Goal' }).click();
  await expect(page.getByRole('region', { name: 'This week’s goals' })).toContainText('★ Write the outline');
  await outline.hover(); // on a computer, Highlight shows on the task under the pointer
  await outline.getByRole('button', { name: 'Make “Write the outline” the Highlight' }).click();
  await expect(highlight(page).locator('.plan-slot')).toHaveText(/Highlight.*Write the outline/);
  await expect(page.locator('.plan-day > *').first()).toHaveAttribute('aria-label', 'Highlight');

  await page.locator('.plan-slot', { hasText: 'Call the bank' }).hover();
  await page.locator('.plan-slot', { hasText: 'Call the bank' }).getByRole('button', { name: 'Make “Call the bank” the Highlight' }).click();
  await expect(highlight(page)).toContainText('Call the bank');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('z');
  await expect(highlight(page)).toContainText('Write the outline');
  await expect(highlight(page).locator('.plan-slot')).toHaveCount(1);
});

test('* in the add bar makes a Weekly Goal; the sixth gets a word, never a stop', async ({ page, app }) => {
  await page.goto(`${app.url}/tasks`);
  await page.keyboard.press('q');
  const bar = page.getByRole('dialog', { name: 'Add a task' }).getByRole('textbox', { name: 'Add a task' });
  await bar.fill('write the offer * fri');
  await expect(page.locator('.quick-chips > *')).toContainText(['★ Weekly Goal']);
  await page.keyboard.press('Enter');
  const [offer] = await tasks(app);
  expect([offer.text, Boolean(offer.goal_week)]).toEqual(['write the offer', true]);

  // On the Tasks page, ☆ marks one too.
  await page.keyboard.press('7');
  for (let i = 1; i <= 5; i++) await post(app, '/api/tasks', { text: `Goal ${i}`, due: localDay() });
  await page.reload();
  for (let i = 1; i <= 5; i++) await page.getByRole('button', { name: `Make “Goal ${i}” a Weekly Goal` }).click();
  await expect(page.getByRole('button', { name: '“Goal 5” is a Weekly Goal. Unmark it' })).toBeVisible();
  await page.goto(`${app.url}/planner`);
  const goals = page.getByRole('region', { name: 'This week’s goals' });
  // write the offer is on Friday: in this week, or (on a weekend) next week's.
  await expect(goals.locator('.week-goals-title')).toHaveText(/This week’s goals · (5|6) of 5/);
  if ((await goals.locator('.week-goal').count()) === 6) await expect(goals).toContainText('6 Weekly Goals: five keep a week clear');
});

const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDay(d); };
const dayIn = (page, day) => page.locator(`.week-column[data-day="${day}"]`);

test('the week: a column a day with its load, amber when over; drag a task onto a day or its Weekly Goal slot', async ({ page, app }, info) => {
  const today = localDay();
  const other = today === monday() ? inDays(1) : monday();
  await post(app, '/api/events', { title: 'Workshop', starts_at: `${today}T09:00`, ends_at: `${today}T12:00` });
  await post(app, '/api/tasks', { text: 'Sort the attic', estimate: 360, due: today });
  await post(app, '/api/tasks', { text: 'Call the bank', estimate: 15 });
  await post(app, '/api/tasks', { text: 'Draft the talk', estimate: 60 });
  await page.goto(`${app.url}/planner?view=week`);
  await expect(page.locator('.week-column')).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'Plan my week' })).toBeVisible();
  // 3 h of meetings + 6 h of tasks, against 8 h.
  await expect(dayIn(page, today).locator('.week-load')).toHaveText('Over by 1 h');
  await expect(dayIn(page, today).locator('.load-bar')).toHaveClass(/is-over/);
  await expect(dayIn(page, other).locator('.week-load')).toHaveText('0 min of 8 h');

  const tray = page.getByRole('complementary', { name: 'Tasks to place' });
  if (info.project.name === 'phone') {
    // On a phone the days stack and the Tray is below them, out of a finger's reach: a
    // task gets its day from Tasks there. The board shows it the same way.
    const all = await tasks(app);
    const id = (text) => all.find((t) => t.text === text).id;
    await fetch(`${app.url}/api/tasks/${id('Call the bank')}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due: other }) });
    await fetch(`${app.url}/api/tasks/${id('Draft the talk')}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ due: other, goal_week: monday() }) });
    await page.reload();
  } else {
    await tray.locator('.tray-row', { hasText: 'Call the bank' }).dragTo(dayIn(page, other));
    await expect(dayIn(page, other).locator('.week-task')).toHaveText([/Call the bank/]);
    await tray.locator('.tray-row', { hasText: 'Draft the talk' }).dragTo(dayIn(page, other).locator('.week-goal-slot'));
  }
  await expect(dayIn(page, other).locator('.week-task')).toHaveText([/Call the bank/]);
  await expect(dayIn(page, other).locator('.week-goal-slot')).toHaveText('★ Draft the talk');
  await expect(page.getByRole('region', { name: 'This week’s goals' })).toContainText('★ Draft the talk');
  const talk = (await tasks(app)).find((t) => t.text === 'Draft the talk');
  expect([talk.due, talk.goal_week]).toEqual([other, monday()]);

  // A day's name opens that day.
  await dayIn(page, other).locator('.week-column-name').click();
  await expect(page).toHaveURL(new RegExp(`/planner/${other}$`));
  // On that day both wait in Tasks to place, under the day's name.
  await expect(page.locator('.tray-rows.is-day .tray-row')).toHaveCount(2);
  await expect(page.locator('.tray-rows.is-day .tray-row', { hasText: 'Draft the talk' })).toBeVisible();
  await expect(page.locator('.tray-rows.is-day .tray-row', { hasText: 'Call the bank' })).toBeVisible();
});

const current = (page) => page.locator('.planning-step[aria-current="step"] .planning-name');

test('p on the week opens Weekly Planning; finish two steps, close, p again: it goes on at the third', async ({ page, app }) => {
  await page.goto(`${app.url}/planner?view=week`);
  await expect(page.locator('.week-column')).toHaveCount(7);
  await page.keyboard.press('p');
  const panel = page.getByRole('complementary', { name: 'Planning' });
  await expect(panel.getByRole('heading', { name: 'Weekly Planning' })).toBeVisible();
  await expect(current(page)).toHaveText('Brain Zen');
  await panel.locator('.planning-step', { hasText: 'Brain Zen' }).getByRole('button', { name: 'Done' }).click();
  await expect(current(page)).toHaveText('Goal Alignment');
  await panel.locator('.planning-step', { hasText: 'Goal Alignment' }).getByRole('button', { name: 'Skip' }).click();
  await expect(current(page)).toHaveText('Schedule');
  await expect(panel).toContainText('2 of 5');
  await panel.getByRole('button', { name: 'Close the planning' }).click();
  await expect(panel).toBeHidden();
  // It is kept: even after a reload.
  await page.reload();
  await expect(page.locator('.week-column')).toHaveCount(7);
  await page.keyboard.press('p');
  await expect(current(page)).toHaveText('Schedule');
  await expect(panel.locator('.planning-step', { hasText: 'Brain Zen' })).toHaveAttribute('data-state', 'done');
  await expect(panel.locator('.planning-step', { hasText: 'Goal Alignment' })).toHaveAttribute('data-state', 'skipped');
  // Undo puts a step back.
  await panel.locator('.planning-step', { hasText: 'Brain Zen' }).getByRole('button', { name: 'Undo' }).click();
  await expect(current(page)).toHaveText('Brain Zen');
});

test('Daily Planning on an overfull day: it says over budget before the Highlight; pick it from the panel', async ({ page, app }) => {
  const today = localDay();
  await post(app, '/api/events', { title: 'Workshop', starts_at: `${today}T09:00`, ends_at: `${today}T12:00` });
  for (const [text, estimate] of [['Write the offer', 180], ['Sort the attic', 240]]) await post(app, '/api/tasks', { text, estimate, due: today });
  await page.goto(`${app.url}/planner`);
  await page.getByRole('button', { name: 'Plan my day' }).click();
  // The five steps are behind the Plan my day dialog.
  await page.getByRole('dialog', { name: 'Plan the day' }).getByRole('button', { name: 'Step by step instead' }).click();
  const panel = page.getByRole('complementary', { name: 'Planning' });
  await expect(panel.getByRole('heading', { name: 'Daily Planning' })).toBeVisible();
  await expect(current(page)).toHaveText('Review the tasks');
  await panel.locator('.planning-step', { hasText: 'Review the tasks' }).getByRole('button', { name: 'Done' }).click();
  await expect(current(page)).toHaveText('Assess feasibility');
  await expect(panel.locator('.planning-step', { hasText: 'Assess feasibility' })).toContainText('The day is over budget by 2 h');
  await panel.locator('.planning-step', { hasText: 'Assess feasibility' }).getByRole('button', { name: 'Done' }).click();
  await expect(current(page)).toHaveText('Identify the Highlight');
  await panel.locator('.planning-picks').getByRole('button', { name: 'Write the offer' }).click();
  await expect(highlight(page)).toContainText('Write the offer');
  await expect(panel.locator('.planning-step', { hasText: 'Identify the Highlight' })).toContainText('The Highlight: Write the offer.');
});
