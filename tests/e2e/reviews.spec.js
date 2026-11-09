import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };
const post = (app, url, body) => fetch(`${app.url}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const tasks = (app) => fetch(`${app.url}/api/tasks?done=all`).then((r) => r.json());
const closedBar = (page) => page.getByRole('region', { name: 'Day closed' });

test('close today: Highlight, what moves, one line; the day says closed and the line is in the journal; reopen and change it', async ({ page, app }) => {
  const today = localDay();
  for (const text of ['Write the offer', 'Pay the invoice', 'Call the bank', 'Sort the attic']) {
    const made = await post(app, '/api/tasks', { text, estimate: 30, due: today });
    await fetch(`${app.url}/api/tasks/${made.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_part: 'morning' }) });
  }
  await page.goto(`${app.url}/planner`);
  await page.locator('.plan-slot', { hasText: 'Pay the invoice' }).getByRole('checkbox').click();
  await page.locator('.plan-slot', { hasText: 'Write the offer' }).hover();
  await page.locator('.plan-slot', { hasText: 'Write the offer' }).getByRole('button', { name: 'Make “Write the offer” the Highlight' }).click();
  await expect(page.getByRole('region', { name: 'Highlight' })).toContainText('Write the offer');

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+X');
  const dialog = page.getByRole('dialog', { name: 'Close the day' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Done today · 1 of 4 planned');
  await dialog.getByRole('group', { name: 'What became of the Highlight' }).getByRole('button', { name: 'Done', exact: true }).click();
  // Left: Missed unless you choose; Call the bank goes to tomorrow.
  await expect(dialog.getByRole('group', { name: 'Where “Sort the attic” goes' }).getByRole('button', { name: 'Missed' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('group', { name: 'Where “Call the bank” goes' }).getByRole('button', { name: 'Tomorrow' }).click();
  await dialog.getByRole('textbox', { name: 'The day in one line' }).fill('Slow start, good afternoon with the offer.');
  await dialog.getByRole('button', { name: 'Close the day' }).click();

  await expect(dialog).toBeHidden();
  await expect(closedBar(page)).toContainText('Day closed');
  await expect(closedBar(page)).toContainText('2 of 4 planned tasks done · Highlight: Write the offer, done');
  await expect(closedBar(page)).toContainText('“Slow start, good afternoon with the offer.”');
  await expect(page.getByRole('button', { name: 'Close the day (⇧X)' })).toHaveCount(0);
  const all = await tasks(app);
  expect(all.find((t) => t.text === 'Call the bank').due).toBe(inDays(1));
  expect(all.find((t) => t.text === 'Sort the attic').due).toBe(today);

  // Reopen it and change the line: the closed day and the journal show the new one.
  await closedBar(page).getByRole('button', { name: 'Reopen' }).click();
  await expect(closedBar(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close the day (⇧X)' }).click();
  await expect(dialog.getByRole('textbox', { name: 'The day in one line' })).toHaveValue('Slow start, good afternoon with the offer.');
  await dialog.getByRole('textbox', { name: 'The day in one line' }).fill('Better than it looked.');
  await dialog.getByRole('textbox', { name: 'The day in one line' }).press('Enter');
  await expect(closedBar(page)).toContainText('“Better than it looked.”');
  await expect(closedBar(page)).toContainText('2 of 4 planned tasks done');

  await closedBar(page).getByRole('link', { name: 'In your journal' }).click();
  await expect(page).toHaveURL(new RegExp(`/journal/${today}$`));
  await expect(page.locator('main')).toContainText('Better than it looked.');
  await expect(page.locator('main')).not.toContainText('Slow start');
});

test('a day to come has no Close the day; an earlier day can still be closed, sending what is left to today', async ({ page, app }) => {
  await post(app, '/api/tasks', { text: 'Dentist prep', estimate: 15, due: inDays(-1) });
  await page.goto(`${app.url}/planner/${inDays(1)}`);
  await expect(page.locator('.plan-part').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close the day (⇧X)' })).toHaveCount(0);
  await page.goto(`${app.url}/planner/${inDays(-1)}`);
  await page.getByRole('button', { name: 'Close the day (⇧X)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close the day' });
  await dialog.getByRole('button', { name: 'All to today' }).click();
  await dialog.getByRole('button', { name: 'Close the day' }).click();
  await expect(closedBar(page)).toContainText('0 of 1 planned task done');
  expect((await tasks(app)).find((t) => t.text === 'Dentist prep').due).toBe(localDay());
});

const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDay(d); };
const review = (page) => page.getByRole('complementary', { name: 'Planning' });

test('⇧R: the Weekly Review shows planned against done and the Highlights; close the week and the wins line stays with it', async ({ page, app }) => {
  const today = localDay();
  const offer = await post(app, '/api/tasks', { text: 'Write the offer', estimate: 30, due: today });
  const invoice = await post(app, '/api/tasks', { text: 'Pay the invoice', estimate: 10, due: today });
  const patch = (id, body) => fetch(`${app.url}/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await patch(offer.id, { done: true });
  await fetch(`${app.url}/api/highlights/${today}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: offer.id }) });
  await fetch(`${app.url}/api/shutdown/${today}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line: 'Offer sent.' }) });

  await page.goto(`${app.url}/planner`);
  await expect(page.locator('.tray-rows.is-day .tray-row').first()).toBeVisible();
  await page.keyboard.press('Shift+R');
  await expect(page).toHaveURL(/view=week/);
  await expect(review(page).getByRole('heading', { name: 'Weekly Review' })).toBeVisible();
  await expect(page.locator(`.week-column[data-day="${today}"] .week-task`, { hasText: 'Pay the invoice' })).toHaveAttribute('data-checked', 'false');
  await expect(review(page).getByRole('region', { name: 'Highlights · 1 of 1 hit' })).toContainText('Write the offer');
  await expect(review(page).getByRole('region', { name: 'Your lines this week' })).toContainText('“Offer sent.”');
  // Typed, then the board redraws (a task ticked): the words stay.
  await review(page).getByRole('textbox', { name: 'This week’s wins' }).fill('The offer');
  await page.locator(`.week-column[data-day="${today}"] .week-task`, { hasText: 'Pay the invoice' }).getByRole('checkbox').click();
  await expect(page.locator(`.week-column[data-day="${today}"] .week-task`, { hasText: 'Pay the invoice' })).toHaveAttribute('data-checked', 'true');
  await expect(review(page).getByRole('textbox', { name: 'This week’s wins' })).toHaveValue('The offer');
  // Untick it, and wait until the panel has its answer (a closed day's counts don't move,
  // so they can't tell): typing while it redraws is the test above, not this one.
  const panelRedrawn = page.waitForResponse((r) => r.url().includes('/api/reviews/week/'));
  await page.locator(`.week-column[data-day="${today}"] .week-task`, { hasText: 'Pay the invoice' }).getByRole('checkbox').click();
  await panelRedrawn;
  await expect(review(page).locator(`.review-day[data-day="${today}"]`)).toContainText('1/2');
  await review(page).getByRole('textbox', { name: 'This week’s wins' }).fill('The offer is out.');
  await review(page).getByRole('button', { name: 'Close the week' }).click();
  await expect(review(page)).toContainText('Week closed');
  await expect(review(page).getByRole('region', { name: 'Wins' })).toContainText('“The offer is out.”');

  // Done afterwards: the closed week's look back stays as it was.
  await patch(invoice.id, { done: true });
  await page.getByRole('button', { name: 'The week after' }).click();
  await page.getByRole('button', { name: 'The week before' }).click();
  await expect(review(page).locator(`.review-day[data-day="${today}"]`)).toContainText('1/2');
  await expect(review(page).getByRole('region', { name: 'Wins' })).toContainText('“The offer is out.”');

  // Then plan next week.
  await review(page).getByRole('button', { name: 'Plan next week' }).click();
  await expect(review(page).getByRole('heading', { name: 'Weekly Planning' })).toBeVisible();
  const next = new Date(`${monday()}T12:00`); next.setDate(next.getDate() + 7);
  await expect(page).toHaveURL(new RegExp(`/planner/${localDay(next)}\\?view=week$`));
});

test('on a phone the Weekly Review opens from the week, no keys needed', async ({ page, app }) => {
  await page.goto(`${app.url}/planner?view=week`);
  await page.getByRole('button', { name: 'Weekly Review (⇧R)' }).click();
  await expect(review(page).getByRole('heading', { name: 'Weekly Review' })).toBeVisible();
  await expect(review(page)).toContainText('No day closed yet');
  await review(page).getByRole('button', { name: 'Close the review' }).click();
  await expect(review(page)).toBeHidden();
});

const life = (app, id) => fetch(`${app.url}/api/life/${id}`).then((r) => r.json());

test('the quarter: its weeks summed up; mark each Goal reached, let go or in play; Goals for the next quarter; close it', async ({ page, app }) => {
  const today = localDay();
  const course = await post(app, '/api/life', { kind: 'goal', title: 'Launch the course', horizon: 'quarter' });
  await post(app, '/api/life', { kind: 'goal', title: 'Write the book', horizon: 'quarter' });
  await post(app, '/api/life', { kind: 'goal', title: 'Run a marathon', horizon: 'year' });
  const offer = await post(app, '/api/tasks', { text: 'Write the offer', due: today, goal_week: monday() });
  await fetch(`${app.url}/api/tasks/${offer.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) });
  await fetch(`${app.url}/api/reviews/week/${today}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wins: 'The offer is out.' }) });

  await page.goto(`${app.url}/planner`);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Quarter' }).click();
  await expect(page).toHaveURL(/view=quarter/);
  const quarter = page.getByRole('region', { name: 'The quarter', exact: true });
  await expect(quarter.locator('.quarter-summary')).toContainText('★ 1 of 1 Weekly Goals done');
  await expect(quarter.locator(`.quarter-week[data-week="${monday()}"]`)).toContainText('★ 1 of 1');
  await expect(quarter.locator(`.quarter-week[data-week="${monday()}"]`)).toContainText('“The offer is out.”');
  await expect(page.getByRole('button', { name: 'Plan my week' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Plan my day' })).toBeHidden();

  const goals = quarter.getByRole('region', { name: 'Goals for this quarter' });
  await expect(goals.locator('.quarter-goal-name')).toHaveText(['Launch the course', 'Write the book']);
  const courseMark = goals.getByRole('group', { name: 'What became of “Launch the course”' });
  await courseMark.getByRole('button', { name: 'Reached' }).click();
  await expect(courseMark.getByRole('button', { name: 'Reached' })).toHaveAttribute('aria-pressed', 'true');
  expect((await life(app, course.id)).state).toBe('archived');
  await courseMark.getByRole('button', { name: 'In play' }).click();
  await expect(courseMark.getByRole('button', { name: 'In play' })).toHaveAttribute('aria-pressed', 'true');
  expect((await life(app, course.id)).state).toBe('active');
  await goals.getByRole('group', { name: 'What became of “Write the book”' }).getByRole('button', { name: 'Let go' }).click();
  await expect(goals.getByRole('group', { name: 'What became of “Write the book”' }).getByRole('button', { name: 'Let go' })).toHaveAttribute('aria-pressed', 'true');
  // Typing at once, while that mark is still being saved: a redraw keeps the words.
  await quarter.getByRole('textbox', { name: 'The quarter in one line' }).pressSequentially('Steady');
  await goals.getByRole('group', { name: 'What became of “Launch the course”' }).getByRole('button', { name: 'Reached' }).click();
  await goals.getByRole('group', { name: 'What became of “Launch the course”' }).getByRole('button', { name: 'In play' }).click();
  await expect.poll(async () => (await life(app, course.id)).state).toBe('active');
  await expect(quarter.getByRole('textbox', { name: 'The quarter in one line' })).toHaveValue('Steady');

  const next = quarter.locator('.quarter-part').last();
  await next.getByRole('textbox').fill('Grow the list');
  await next.getByRole('textbox').press('Enter');
  await expect(next.locator('.quarter-goal-name')).toHaveText(['Grow the list']);
  await expect(goals.locator('.quarter-goal-name')).toHaveText(['Launch the course', 'Write the book']);

  await quarter.getByRole('textbox', { name: 'The quarter in one line' }).fill('Steady, with one launch.');
  await quarter.getByRole('button', { name: 'Close the quarter' }).click();
  await expect(quarter.locator('.quarter-summary')).toContainText('Quarter closed');
  await expect(quarter).toContainText('“Steady, with one launch.”');
  await expect(goals.locator('.quarter-goal')).toContainText(['In play', 'Let go']);

  // A week's date opens that week.
  await quarter.locator(`.quarter-week[data-week="${monday()}"] .quarter-week-name`).click();
  await expect(page).toHaveURL(/view=week/);
});

test('loose ends are items in the review: a week never closed, with Close it', async ({ page, app }) => {
  await page.goto(`${app.url}/planner?view=quarter`);
  const start = new Date(); start.setMonth(Math.floor(start.getMonth() / 3) * 3 - 3, 1);
  await page.getByRole('button', { name: 'The quarter before' }).click();
  await expect(page.locator('.cal-range')).toContainText(`Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`);
  const loose = page.getByRole('region', { name: 'Loose ends' });
  const count = await loose.locator('.quarter-loose').count();
  expect(count).toBeGreaterThan(10); // every week of a past quarter, none closed
  await expect(loose.locator('.quarter-loose').first()).toContainText('was never closed');
  await loose.locator('.quarter-loose').first().getByRole('button', { name: 'Close it' }).click();
  await expect(loose.locator('.quarter-loose')).toHaveCount(count - 1);
  await expect(page.locator('.badge, .count-badge')).toHaveCount(0);
});
