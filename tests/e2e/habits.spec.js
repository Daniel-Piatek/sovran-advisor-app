// Habits, the fifth kind in My Life (advanced/mylife/1), in the browser.

import { test, expect } from './fixtures.js';

const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());

async function lifeWithHabits(app) {
  const health = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Health' });
  const family = await send(app, 'POST', '/api/life', { kind: 'key_element', title: 'Family and friends' });
  const goal = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Run ten kilometres', home_id: health.id });
  const run = await send(app, 'POST', '/api/life', {
    kind: 'habit', title: 'Run 3× a week', home_id: health.id, serves: [goal.id], cadence_times: 3, done_when: 'Twenty minutes or more, outside',
  });
  const dinner = await send(app, 'POST', '/api/life', { kind: 'habit', title: 'Family dinner Sunday', home_id: family.id });
  return { health, family, goal, run, dinner };
}

test('the list and the cards show Habits under their Key Element, with their own shape', async ({ page, app }) => {
  await lifeWithHabits(app);
  await page.goto(`${app.url}/life`);
  const card = page.locator('.life-card', { hasText: 'Health' });
  await expect(card.locator('.life-card-heading')).toHaveText(['Goals', 'Habits']);
  await expect(card.locator('.life-card-rows').nth(1).locator('.life-row-title')).toHaveText(['Run 3× a week']);
  await expect(card.locator('.life-row', { hasText: 'Run 3× a week' }).locator('.icon[data-icon="habit"]')).toHaveCount(1);
  await expect(page.locator('.life-list .life-row-child', { hasText: 'Family dinner Sunday' })).toHaveCount(1);
});

test('a Habit page keeps its rhythm, what counts as done and the Goal it carries, after a reload', async ({ page, app }) => {
  const { run, goal } = await lifeWithHabits(app);
  await page.goto(`${app.url}/life/${run.id}`);
  await expect(page.locator('.life-top-kind')).toContainText('Habit in Health');
  await expect(page.getByLabel('How many times')).toHaveValue('3');
  await expect(page.getByLabel('Per week or per month')).toHaveValue('week');
  await expect(page.getByLabel('Counts as done when')).toHaveValue('Twenty minutes or more, outside');
  await expect(page.locator('.life-serves-goal')).toContainText('Run ten kilometres');
  // Change them; each saves as you type.
  await page.getByLabel('How many times').fill('4');
  await page.getByLabel('Counts as done when').fill('Twenty minutes or more, outside, any pace');
  await page.getByLabel('Per week or per month').selectOption('month');
  await page.getByLabel('How many times').fill('12');
  await expect(page.locator('.save-status')).toHaveText(/Saved/);
  await page.reload();
  await expect(page.getByLabel('How many times')).toHaveValue('12');
  await expect(page.getByLabel('Per week or per month')).toHaveValue('month');
  await expect(page.getByLabel('Counts as done when')).toHaveValue('Twenty minutes or more, outside, any pace');
  // The Goal lists it as carried by it.
  await page.goto(`${app.url}/life/${goal.id}`);
  await expect(page.locator('.life-under .life-item-row', { hasText: 'Run 3× a week' }).locator('.life-item-sub')).toHaveText('12× a month');
});

test('a week never takes more than seven; switching to week brings the number down', async ({ page, app }) => {
  const { run } = await lifeWithHabits(app);
  await send(app, 'PATCH', `/api/life/${run.id}`, { cadence_per: 'month', cadence_times: 20 });
  await page.goto(`${app.url}/life/${run.id}`);
  await page.getByLabel('Per week or per month').selectOption('week');
  await expect(page.getByLabel('How many times')).toHaveValue('7');
  await expect(page.locator('.save-status')).toHaveText(/Saved/);
  const saved = await send(app, 'GET', `/api/life/${run.id}`);
  expect([saved.cadence_times, saved.cadence_per]).toEqual([7, 'week']);
});

test('+ Habit on a Key Element makes one that starts once a week', async ({ page, app }) => {
  const { health } = await lifeWithHabits(app);
  await page.goto(`${app.url}/life/${health.id}`);
  const habits = page.getByRole('region', { name: 'Habits', exact: true });
  await expect(habits.locator('.life-section-title')).toHaveText('Habits · 1');
  await habits.getByRole('button', { name: /Habit$/ }).click();
  await habits.getByLabel('New Habit’s name').fill('Stretch');
  await habits.getByLabel('New Habit’s name').press('Enter');
  await expect(habits.locator('.life-section-title')).toHaveText('Habits · 2');
  await expect(habits.locator('.life-item-row', { hasText: 'Stretch' }).locator('.life-item-sub')).toHaveText('1× a week');
});

test('a Habit that carries a Goal shows under the Key Element of that Goal too', async ({ page, app }) => {
  const { family, goal } = await lifeWithHabits(app);
  const walk = await send(app, 'POST', '/api/life', { kind: 'habit', title: 'Walk together', home_id: family.id, serves: [goal.id] });
  await page.goto(`${app.url}/life/${(await send(app, 'GET', '/api/life')).find((i) => i.title === 'Health').id}`);
  await expect(page.getByRole('region', { name: 'Habits', exact: true }).locator('.life-item-title')).toHaveText(['Run 3× a week', 'Walk together']);
  expect(walk.kind).toBe('habit');
});

test('with My Life in depth off there are no Habits and no + Habit; switched on they are back', async ({ page, app }) => {
  const { health } = await lifeWithHabits(app);
  await send(app, 'PATCH', '/api/modules', { id: 'mylife-plus', on: false });
  await page.goto(`${app.url}/life`);
  await expect(page.locator('.life-card', { hasText: 'Health' }).locator('.life-card-heading')).toHaveText(['Goals']);
  await expect(page.locator('.life-list')).not.toContainText('Run 3× a week');
  await page.goto(`${app.url}/life/${health.id}`);
  await expect(page.getByRole('region', { name: 'Habits', exact: true })).toHaveCount(0);
  await send(app, 'PATCH', '/api/modules', { id: 'mylife-plus', on: true });
  await page.goto(`${app.url}/life/${health.id}`);
  await expect(page.getByRole('region', { name: 'Habits', exact: true })).toHaveCount(1);
});
