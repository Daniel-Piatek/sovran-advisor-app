// Tasks in depth (advanced/tasks/1): q adds a task in one line; what the estimate makes it, a Speedy (15 minutes or
// less) or a Task, shows in the chips while typing and as a mark on every row; Settings › Modules switches it off.
import { test, expect } from './fixtures.js';

const post = (app, body) => fetch(`${app.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const allTasks = (app) => fetch(`${app.url}/api/tasks`).then((r) => r.json());
const box = (page) => page.getByRole('dialog', { name: 'Add a task' });
const marks = (page) => page.locator('.task-row .kind-mark');

test('q reads "reply to Jonas tomorrow ~5m": chips say Tomorrow and Speedy, and the title keeps every other word', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('q');
  await expect(box(page)).toBeVisible();
  await page.keyboard.type('reply to Jonas tomorrow ~5m');
  await expect(box(page).locator('.quick-chips > *')).toHaveText(['5 min · Speedy']);
  await expect(box(page).getByLabel('Day')).not.toHaveValue('');
  await page.keyboard.press('Enter');
  const [task] = await allTasks(app);
  expect([task.text, task.estimate]).toEqual(['reply to Jonas', 5]);
});

test('fifteen minutes is the last Speedy; sixteen is a Task; over three hours it only suggests splitting', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('q');
  const chips = box(page).locator('.quick-chips > *');
  const line = box(page).getByRole('textbox', { name: 'Add a task' });
  await line.fill('a ~15m');
  await expect(chips).toHaveText(['15 min · Speedy']);
  await line.fill('b ~16m');
  await expect(chips).toHaveText(['16 min · Task']);
  await line.fill('c ~4h');
  await expect(chips).toHaveText(['4 h · Task']);
  await expect(box(page)).toContainText('may be worth splitting');
  await page.keyboard.press('Enter'); // never blocks
  await expect.poll(async () => (await allTasks(app)).map((t) => t.estimate)).toEqual([240]);
});

test('every row says Speedy or Task with its minutes, in a shape and in words; no estimate, no mark', async ({ page, app }) => {
  await post(app, { text: 'Reply to Jonas', due: new Date().toLocaleDateString('en-CA'), estimate: 5 });
  await post(app, { text: 'Write the offer', due: new Date().toLocaleDateString('en-CA'), estimate: 90 });
  await post(app, { text: 'Sort the attic', due: new Date().toLocaleDateString('en-CA') });
  await page.goto(`${app.url}/tasks`);
  await expect(marks(page)).toHaveText(['Speedy · 5 min', 'Task · 1 h 30 min']);
  await expect(marks(page).first()).toHaveAttribute('data-kind', 'speedy');
  await expect(marks(page).first().locator('svg')).toHaveCount(1);
  await expect(marks(page).nth(1).locator('svg')).toHaveCount(1);
  const attic = page.locator('.task-row').filter({ hasText: 'Sort the attic' });
  await expect(attic.locator('.kind-mark')).toHaveCount(0);
  // the Speedies view counts fifteen minutes too
  await post(app, { text: 'Book the room', estimate: 15 });
  await post(app, { text: 'Plan the day', estimate: 16 });
  await page.goto(`${app.url}/tasks?view=speedies`);
  await expect(page.locator('.task-row .task-words')).toHaveText([/Book the room/]);
});

test('switched off, q does nothing and the marks go; every task stays; switched on, they are back', async ({ page, app }) => {
  await post(app, { text: 'Reply to Jonas', due: new Date().toLocaleDateString('en-CA'), estimate: 5 });
  await page.goto(`${app.url}/settings`);
  const row = page.locator('[data-module="tasks-plus"]');
  await expect(row).toContainText('Tasks in depth');
  await expect(row.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`${app.url}/tasks`);
  await expect(page.locator('.task-row .task-words')).toHaveText([/Reply to Jonas/]);
  await expect(marks(page)).toHaveCount(0);
  await expect(page.locator('.task-row .due-chip').filter({ hasText: '5 min' })).toHaveCount(1);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('q');
  await expect(box(page)).toHaveCount(0);
  expect((await allTasks(app)).length).toBe(1);

  await page.goto(`${app.url}/settings`);
  await row.getByRole('button', { name: 'On', exact: true }).click();
  await expect(row.getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/tasks`);
  await expect(marks(page)).toHaveText(['Speedy · 5 min']);
  await page.keyboard.press('q');
  await expect(box(page).getByRole('textbox', { name: 'Add a task' })).toBeFocused();
});

test('the Library shows the Speedy mark', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Speedy mark', level: 2 })).toBeVisible();
  await expect(page.locator('.kind-mark')).toHaveText(['Speedy · 10 min', 'Task · 45 min']);
});

const pad = (n) => String(n).padStart(2, '0');
const minutesAgo = (n) => { const d = new Date(Date.now() - n * 60_000); return [d.toLocaleDateString('en-CA'), `${pad(d.getHours())}:${pad(d.getMinutes())}`]; };

test('the notice offers Snooze for 10 min, 1 h or tomorrow, and Done ends only the alarm', async ({ page, app }) => {
  const [day, time] = minutesAgo(1);
  await post(app, { text: 'send invoice 2026-118', due: day, remind_time: time });
  await post(app, { text: 'call the printer', due: day, remind_time: time });
  await post(app, { text: 'ring Mara', due: day, remind_time: time });
  await page.goto(`${app.url}/notes`);
  const notices = page.locator('.notice');
  await expect(notices).toHaveCount(3);
  const first = notices.first();
  await expect(first.getByRole('group', { name: 'Snooze' }).getByRole('button')).toHaveText(['10 min', '1 h', 'Tomorrow']);
  await first.getByRole('button', { name: 'Snooze 1 h' }).click();
  await notices.first().getByRole('button', { name: 'Snooze until tomorrow' }).click();
  await expect(notices).toHaveCount(1);
  await notices.first().getByRole('button', { name: 'Done' }).click();
  await expect(notices).toHaveCount(0);
  expect((await allTasks(app)).length).toBe(3); // no task was finished
  const waiting = await fetch(`${app.url}/api/reminders?state=waiting`).then((r) => r.json());
  expect(waiting.length).toBe(2); // snoozed ones are still alarms
  expect(waiting.map((r) => r.snoozed_until.slice(11)).sort()).toEqual([expect.stringMatching(/^\d\d:\d\d$/), time].sort());
});

test('the Reminders view lists every alarm with its task, and the ended ones struck through', async ({ page, app }) => {
  const [day, time] = minutesAgo(1);
  await post(app, { text: 'send invoice 2026-118', due: day, remind_time: '14:00' });
  await post(app, { text: 'call Lena', due: day, remind_time: time });
  await page.goto(`${app.url}/tasks?view=reminders`);
  await expect(page.locator('.task-row .task-words')).toHaveText([/call Lena/, /send invoice 2026-118/]); // soonest alarm first
  await expect(page.locator('.alarm-row')).toHaveCount(0);
  await page.locator('.notice').getByRole('button', { name: 'Done' }).click();
  await page.goto(`${app.url}/tasks?view=reminders`);
  await expect(page.locator('.task-row .task-words')).toHaveText([/send invoice 2026-118/]); // the waiting alarm; the ended one moved down
  expect((await allTasks(app)).length).toBe(2); // both tasks are still open
  const ended = page.getByRole('region', { name: 'Alarms ended' });
  await expect(ended.locator('.alarm-row')).toHaveCount(1);
  await expect(ended.locator('.alarm-words')).toHaveText('call Lena');
  await expect(ended.locator('s')).toHaveText('call Lena');
});

test('with Tasks in depth switched off no notice shows, and the reminder is still there', async ({ page, app }) => {
  const [day, time] = minutesAgo(1);
  await post(app, { text: 'call Lena', due: day, remind_time: time });
  await page.goto(`${app.url}/notes`);
  await expect(page.locator('.notice')).toHaveCount(1);
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="tasks-plus"]').getByRole('button', { name: 'Off', exact: true }).click();
  await expect(page.locator('[data-module="tasks-plus"]').getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/notes`);
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(page.locator('.notice')).toHaveCount(0);
  expect((await fetch(`${app.url}/api/reminders?state=waiting`).then((r) => r.json())).length).toBe(1);
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="tasks-plus"]').getByRole('button', { name: 'On', exact: true }).click();
  await expect(page.locator('[data-module="tasks-plus"]').getByRole('button', { name: 'On', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/notes`);
  await expect(page.locator('.notice')).toHaveCount(1);
});

test('the Library shows the Notice', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Notice', level: 2 })).toBeVisible();
  await expect(page.locator('.lib-notice .notice')).toContainText('Send invoice 2026-118');
  await expect(page.locator('.lib-notice').getByRole('button')).toHaveText(['10 min', '1 h', 'Tomorrow', 'Done']);
});

test('a snooze is minutes or tomorrow, nothing else', async ({ app }) => {
  const [day, time] = minutesAgo(1);
  const task = await post(app, { text: 'call Lena', due: day, remind_time: time });
  const due = await fetch(`${app.url}/api/reminders/due`).then((r) => r.json());
  const patch = (body) => fetch(`${app.url}/api/reminders/${due[0].id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect((await patch({ snooze: 'next week' })).status).toBe(400);
  expect((await patch({ snooze: 0 })).status).toBe(400);
  expect((await fetch(`${app.url}/api/reminders?state=bogus`)).status).toBe(400);
  expect((await patch({ snooze: 'tomorrow' })).status).toBe(200);
  void task;
});

const today = () => new Date().toLocaleDateString('en-CA');
const row = (page, text) => page.locator('.task-row').filter({ hasText: text });

test('a repeat in words shows as a chip, finishing the task writes the next one and says when it is', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('q');
  await page.keyboard.type('pay the rent every 2 weeks ~10m');
  await expect(box(page).locator('.quick-chips > *')).toHaveText(['10 min · Speedy', 'Every 2 weeks']);
  await page.keyboard.press('Enter');
  const [first] = await allTasks(app);
  expect([first.text, first.repeat]).toEqual(['pay the rent', 'every 2 weeks']);

  await page.goto(`${app.url}/tasks?view=all`);
  await expect(row(page, 'pay the rent').locator('.repeat-chip')).toHaveText('Every 2 weeks');
  await row(page, 'pay the rent').getByRole('checkbox').click();
  const bar = page.locator('.undo-bar').filter({ hasText: 'pay the rent' });
  await expect(bar).toContainText('done. Next:');
  const open = await allTasks(app);
  expect(open.length).toBe(1);
  expect([open[0].text, open[0].repeat, open[0].repeat_from]).toEqual(['pay the rent', 'every 2 weeks', first.id]);
  const days = (new Date(`${open[0].due}T12:00`) - new Date(`${first.due}T12:00`)) / 86_400_000;
  expect(Math.round(days)).toBe(14);
});

test('Undo of a finished repeat takes the next one away again, and the rule comes back', async ({ page, app }) => {
  await post(app, { text: 'water the plants', due: today(), repeat: 'every monday', estimate: 10 });
  await page.goto(`${app.url}/tasks`);
  await row(page, 'water the plants').getByRole('checkbox').click();
  await expect.poll(async () => (await allTasks(app)).length).toBe(1);
  expect((await allTasks(app))[0].repeat_from).not.toBeNull();
  await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await allTasks(app)).map((t) => t.repeat_from)).toEqual([null]);
  const [back] = await allTasks(app);
  expect([back.text, back.repeat, back.done]).toEqual(['water the plants', 'every monday', false]);
  await expect(page.locator('.task-row').filter({ hasText: 'water the plants' })).toHaveCount(1);
  await expect(row(page, 'water the plants').locator('.repeat-chip')).toHaveText('Every monday');
});

test('with Tasks in depth off, a finished repeating task stays finished with no next one', async ({ page, app }) => {
  await post(app, { text: 'weekly review', due: today(), repeat: 'every friday' });
  await page.goto(`${app.url}/settings`);
  const module = page.locator('[data-module="tasks-plus"]');
  await module.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(module.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/tasks`);
  await row(page, 'weekly review').getByRole('checkbox').click();
  await expect(page.locator('.undo-bar').filter({ hasText: 'weekly review' })).toBeVisible();
  expect((await allTasks(app)).length).toBe(0);
});

test('the Library shows the Repeat chip', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Repeat chip', level: 2 })).toBeVisible();
  await expect(page.locator('.repeat-chip')).toHaveText(['Every monday', 'Every 2 weeks']);
});

test('two Speedies: x picks both, the line says two are selected, m moves both to tomorrow, Undo brings them back', async ({ page, app }) => {
  await post(app, { text: 'call the dentist', estimate: 15 });
  await post(app, { text: 'reply to Lena', estimate: 5 });
  await page.goto(`${app.url}/tasks`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('3'); // Speedies
  await expect(page.getByRole('tab', { name: /Speedies/, selected: true })).toBeVisible();
  await expect(page.locator('.task-row .task-words')).toHaveCount(2);
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await expect(page.locator('.task-selection')).toContainText('2 tasks selected');
  await expect(page.locator('.task-selected-word')).toHaveText([/Selected/, /Selected/]);
  await page.keyboard.press('m');
  await expect(page.locator('.undo-bar').filter({ hasText: '2 tasks' })).toBeVisible();
  expect((await allTasks(app)).map((t) => t.due)).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
  await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await allTasks(app)).map((t) => t.due)).toEqual(['', '']);
});

test('keys never act inside a text field, and Esc clears the selection', async ({ page, app }) => {
  await post(app, { text: 'one', due: today() });
  await post(app, { text: 'two', due: today() });
  await page.goto(`${app.url}/tasks`);
  await page.getByLabel('Search tasks').focus();
  await page.keyboard.type('jjxxee');
  await expect(page.getByLabel('Search tasks')).toHaveValue('jjxxee');
  await page.getByLabel('Search tasks').fill('');
  await expect(page.locator('.task-selection')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await expect(page.locator('.task-selection')).toContainText('2 tasks selected');
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-selection')).toBeHidden();
});

test('with Tasks in depth off the Tasks page has its core views again, and the number keys follow', async ({ page, app }) => {
  await post(app, { text: 'quick one', estimate: 5 });
  await page.goto(`${app.url}/tasks`);
  await expect(page.getByRole('tab')).toHaveText([/Today/, /Upcoming/, /Speedies/, /Reminders/, /Someday/, /Needs a date/, /All/, /Done/, /Missed/]);
  await page.goto(`${app.url}/settings`);
  const module = page.locator('[data-module="tasks-plus"]');
  await module.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(module.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/tasks`);
  await expect(page.getByRole('tab')).toHaveText([/Today/, /Upcoming/, /All/, /Done/]);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('3');
  await expect(page.getByRole('tab', { name: /All/, selected: true })).toBeVisible();
  await page.goto(`${app.url}/tasks?view=speedies`);
  await expect(page.getByRole('tab', { name: /Today/, selected: true })).toBeVisible(); // a view that is not there falls back
  expect((await allTasks(app)).length).toBe(1); // nothing was lost
});

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

test('Missed (key 9) keeps what was planned for an earlier day with its old day, and nothing moves by itself', async ({ page, app }) => {
  await post(app, { text: 'update the workshop page', due: inDays(-6) });
  await post(app, { text: 'renew the pass', due: inDays(-2) });
  await post(app, { text: 'plan the week', due: today() });
  await page.goto(`${app.url}/tasks`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('9');
  await expect(page.getByRole('tab', { name: /Missed/, selected: true })).toBeVisible();
  await expect(page.locator('.task-row .task-words')).toHaveText([/update the workshop page/, /renew the pass/]); // oldest first
  await page.waitForLoadState('networkidle'); // the view reloads once more as it opens; keys wait for that
  await expect(page.locator('.task-row .task-words .due-chip').first()).not.toHaveText('Today');
  expect((await allTasks(app)).map((t) => t.due).sort()).toEqual([inDays(-6), inDays(-2), today()].sort());

  await row(page, 'update the workshop page').focus();
  await page.keyboard.press('t'); // today
  await expect(page.locator('.task-row .task-words')).toHaveText([/renew the pass/]);
  expect((await allTasks(app)).find((t) => t.text === 'update the workshop page').due).toBe(today());

  await row(page, 'renew the pass').focus();
  await page.keyboard.press('l'); // let it go, with Undo
  await expect(page.locator('.undo-bar').filter({ hasText: 'let go' })).toBeVisible();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await expect(page.getByText('Nothing missed.')).toBeVisible();
  expect((await allTasks(app)).some((t) => t.text === 'renew the pass')).toBe(false);
  await page.locator('.undo-bar').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.task-row .task-words')).toHaveText([/renew the pass/]);
  expect((await allTasks(app)).find((t) => t.text === 'renew the pass').due).toBe(inDays(-2)); // back with its old day
});

test('d picks another day for a missed task, and m moves it to tomorrow', async ({ page, app }) => {
  await post(app, { text: 'call the printer', due: inDays(-3) });
  await post(app, { text: 'book the room', due: inDays(-1) });
  await page.goto(`${app.url}/tasks?view=missed`);
  await page.waitForLoadState('networkidle');
  await row(page, 'call the printer').focus();
  await page.keyboard.press('d');
  const pick = page.getByLabel('New day for “call the printer”');
  await expect(pick).toBeFocused();
  await pick.fill(inDays(10));
  await expect.poll(async () => (await allTasks(app)).find((t) => t.text === 'call the printer').due).toBe(inDays(10));
  await expect(row(page, 'call the printer')).toHaveCount(0); // it left Missed: the page has drawn again
  await page.waitForLoadState('networkidle');
  await row(page, 'book the room').focus();
  await page.keyboard.press('m');
  await expect.poll(async () => (await allTasks(app)).find((t) => t.text === 'book the room').due).toBe(inDays(1));
});

test('the Planner says how many are missed and opens the Missed view; off, the line and the view go', async ({ page, app }) => {
  await post(app, { text: 'update the workshop page', due: inDays(-4) });
  await page.goto(`${app.url}/planner`);
  const line = page.locator('.planner-missed-line');
  await expect(line).toContainText('1 missed');
  await line.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/tasks\?view=missed$/);
  await expect(page.locator('.task-row .task-words')).toHaveText([/update the workshop page/]);

  await page.goto(`${app.url}/settings`);
  const module = page.locator('[data-module="tasks-plus"]');
  await module.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(module.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/planner`);
  await expect(page.getByRole('heading', { name: 'Planner' })).toBeVisible();
  await expect(page.locator('.planner-missed-line')).toHaveCount(0);
  await page.goto(`${app.url}/tasks`);
  await expect(page.getByRole('tab', { name: /Missed/ })).toHaveCount(0);
});

test('the Library shows the Missed row', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'Missed row', level: 2 })).toBeVisible();
});

const capture = (page) => page.getByRole('region', { name: 'Capture from anywhere' });
const share = (app, token, body) => fetch(`${app.url}/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Capture-Token': token }, body: JSON.stringify(body) });

test('Settings › Capture from anywhere: a device, its token shown once, a bookmarklet, the Inbox line, and Revoke', async ({ page, app }) => {
  await page.goto(`${app.url}/settings`);
  await expect(capture(page)).toContainText(`${app.url}/capture`);
  await expect(capture(page)).toContainText('No device yet.');
  await capture(page).getByLabel('Device name').fill('Work browser');
  await capture(page).getByLabel('Kind of device').selectOption('browser');
  await capture(page).getByRole('button', { name: 'Add a device' }).click();
  const box = capture(page).getByRole('group', { name: 'Token for Work browser' });
  await expect(box).toContainText('shown once');
  const token = (await box.locator('.capture-token').textContent()).trim();
  expect(token).toMatch(/^[0-9a-f-]{36}\.\S{20,}$/);
  const bookmarklet = box.getByRole('link', { name: 'Keep in app' });
  const href = await bookmarklet.getAttribute('href');
  expect(href).toMatch(/^javascript:/);
  expect(decodeURIComponent(href)).toContain(`${app.url}/capture`);
  expect(decodeURIComponent(href)).toContain(token);
  await expect(capture(page).locator('[data-device="Work browser"]')).toContainText('Never used');

  // A page posts with the token: it waits in the Inbox, saying where it came from.
  expect((await share(app, token, { text: 'Link from Lena', link: 'https://example.com/lena' })).status).toBe(201);
  expect((await share(app, 'wrong', { text: 'x' })).status).toBe(401);
  await page.goto(`${app.url}/inbox`);
  await expect(page.locator('.inbox-shared')).toHaveText('Shared from Work browser');
  await page.goto(`${app.url}/settings`);
  await expect(capture(page).locator('[data-device="Work browser"]')).toContainText('Last used just now · 1 capture');
  await expect(capture(page).locator('.capture-token')).toHaveCount(0); // the token is not shown again

  await capture(page).getByRole('button', { name: 'Revoke Work browser' }).click();
  await expect(capture(page).locator('[data-device]')).toHaveCount(0);
  expect((await share(app, token, { text: 'after revoking' })).status).toBe(401);
});

test('with Tasks in depth off the part and the address go; the captures stay', async ({ page, app }) => {
  const made = await fetch(`${app.url}/api/capture/devices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Phone', kind: 'phone' }) }).then((r) => r.json());
  expect((await share(app, made.token, { text: 'kept' })).status).toBe(201);
  await page.goto(`${app.url}/settings`);
  await expect(capture(page)).toBeVisible();
  const module = page.locator('[data-module="tasks-plus"]');
  await module.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(capture(page)).toHaveCount(0);
  const refused = await share(app, made.token, { text: 'refused' });
  expect([refused.status, (await refused.json()).error]).toEqual([503, 'This module is off.']);
  expect((await fetch(`${app.url}/api/captures`).then((r) => r.json())).length).toBe(1);
});

const makeCapture = (app, body, world) => fetch(`${app.url}/api/captures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, world }) }).then((r) => r.json());
const items = (page) => page.locator('.inbox-list .inbox-item');

test('the Inbox keeps two piles, Inner World above Outer World, each oldest first and each with its tag', async ({ page, app }) => {
  await makeCapture(app, 'inner one', 'inner');
  await makeCapture(app, 'newsletter: pricing ideas', 'outer');
  await makeCapture(app, 'inner two', 'inner');
  await makeCapture(app, 'link from Lena', 'outer');
  await makeCapture(app, 'inner three', 'inner');
  await page.goto(`${app.url}/inbox`);
  await expect(page.locator('.inbox-pile')).toHaveText([/Inner World · 3/, /Outer World · 2/]);
  await expect(items(page).locator('.inbox-item-line')).toHaveText(['inner one', 'inner two', 'inner three', 'newsletter: pricing ideas', 'link from Lena']);
  await expect(page.locator('.inbox-pile[data-world="inner"] svg')).toHaveCount(1); // the circle
  await expect(page.locator('.inbox-pile[data-world="outer"] svg')).toHaveCount(1); // the square
  await expect(items(page).first().locator('.world-tag')).toHaveAttribute('data-world', 'inner');
  await expect(items(page).nth(3).locator('.world-tag')).toHaveAttribute('data-world', 'outer');
});

test('w switches the world of a capture, and it moves to the other pile in its place by time', async ({ page, app }) => {
  await makeCapture(app, 'first outer', 'outer');
  await makeCapture(app, 'second', 'inner');
  await makeCapture(app, 'third outer', 'outer');
  await page.goto(`${app.url}/inbox`);
  await expect(items(page).locator('.inbox-item-line')).toHaveText(['second', 'first outer', 'third outer']);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await items(page).filter({ hasText: 'third outer' }).click();
  await page.keyboard.press('w'); // to the Inner World, in its place by time
  await expect(items(page).locator('.inbox-item-line')).toHaveText(['second', 'third outer', 'first outer']);
  await expect(page.locator('.inbox-pile')).toHaveText([/Inner World · 2/, /Outer World · 1/]);
  await expect(page.getByRole('group', { name: 'World of this capture' }).getByRole('button', { name: 'Inner' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('w'); // and back: oldest-first in the Outer pile
  await expect(items(page).locator('.inbox-item-line')).toHaveText(['second', 'first outer', 'third outer']);
  const worlds = (await fetch(`${app.url}/api/captures`).then((r) => r.json())).map((c) => [c.body, c.world]);
  expect(worlds).toEqual([['first outer', 'outer'], ['second', 'inner'], ['third outer', 'outer']]);
});

test('with Tasks in depth off the Inbox is one list again, oldest first, and every capture is there', async ({ page, app }) => {
  await makeCapture(app, 'one', 'inner');
  await makeCapture(app, 'two', 'outer');
  await makeCapture(app, 'three', 'inner');
  await page.goto(`${app.url}/settings`);
  const module = page.locator('[data-module="tasks-plus"]');
  await module.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(module.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/inbox`);
  await expect(items(page).locator('.inbox-item-line')).toHaveText(['one', 'two', 'three']);
  await expect(page.locator('.inbox-pile')).toHaveCount(0);
});

test('the Library shows the World tag', async ({ page, app }) => {
  await page.goto(`${app.url}/library`);
  await expect(page.getByRole('heading', { name: 'World tag', level: 2 })).toBeVisible();
  await expect(page.locator('.lib-sample .world-tag')).toHaveText(['Inner', 'Outer']);
});

const viewTab = (page, name) => page.getByRole('tablist', { name: 'Inbox views' }).getByRole('tab', { name: new RegExp(`^${name}`) });
const pauseMs = (ms = 1100) => new Promise((resolve) => setTimeout(resolve, ms));

test('the Inbox has four views with their counts; s snoozes, d marks done, l lets go, and each view brings one back', async ({ page, app }) => {
  await makeCapture(app, 'Newsletter: pricing ideas', 'outer');
  await pauseMs();
  await makeCapture(app, 'Idea: a one-page summary after every workshop', 'inner');
  await pauseMs();
  await makeCapture(app, 'Slept badly, a short walk helped', 'inner');
  await page.goto(`${app.url}/inbox`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole('tablist', { name: 'Inbox views' }).getByRole('tab')).toHaveText([/To sort/, /Snoozed/, /Done/, /Trash/]);
  await expect(viewTab(page, 'To sort')).toContainText('3');

  // s: snooze the one the keys are on (the Inner pile comes first: the idea).
  await items(page).filter({ hasText: 'Idea: a one-page summary' }).click();
  await page.keyboard.press('s');
  await expect(page.getByRole('group', { name: 'Snooze until' })).toBeVisible();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await page.goto(`${app.url}/inbox`); // (on a phone the list is behind the open capture)
  await expect(viewTab(page, 'Snoozed')).toContainText('1');
  // d: done
  await items(page).filter({ hasText: 'Slept badly' }).click();
  await page.keyboard.press('d');
  await page.goto(`${app.url}/inbox`);
  await expect(viewTab(page, 'Done')).toContainText('1');
  // l: let it go
  await items(page).filter({ hasText: 'Newsletter' }).click();
  await page.keyboard.press('l');
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  await page.goto(`${app.url}/inbox`);
  await expect(viewTab(page, 'Trash')).toContainText('1');
  await expect(viewTab(page, 'To sort')).not.toContainText('1');

  await viewTab(page, 'Snoozed').click();
  const row = page.locator('.inbox-other-row');
  await expect(row).toContainText('Idea: a one-page summary');
  await expect(row).toContainText('Back ');
  await row.getByRole('button', { name: 'Wake now' }).click();
  await expect(viewTab(page, 'To sort')).toContainText('1');

  await viewTab(page, 'Done').click();
  await expect(page.locator('.inbox-other-row')).toContainText('Slept badly');
  await page.locator('.inbox-other-row').getByRole('button', { name: 'Back to the Inbox' }).click();
  await expect(viewTab(page, 'To sort')).toContainText('2');

  await viewTab(page, 'Trash').click();
  await expect(page.locator('.inbox-other-row')).toContainText('Newsletter: pricing ideas');
  await page.locator('.inbox-other-row').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('The Trash is empty.')).toBeVisible();
  await viewTab(page, 'To sort').click();
  await expect(items(page)).toHaveCount(3);
  await expect(page.locator('.inbox-pile')).toHaveText([/Inner World · 2/, /Outer World · 1/]);
});

test('with Tasks in depth off the Inbox has no views, and s and l do nothing', async ({ page, app }) => {
  await makeCapture(app, 'one', 'inner');
  await page.goto(`${app.url}/settings`);
  const module = page.locator('[data-module="tasks-plus"]');
  await module.getByRole('button', { name: 'Off', exact: true }).click();
  await expect(module.getByRole('button', { name: 'Off', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goto(`${app.url}/inbox`);
  await expect(items(page)).toHaveCount(1);
  await expect(page.getByRole('tablist', { name: 'Inbox views' })).toBeHidden();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('l');
  await page.keyboard.press('s');
  await expect(items(page)).toHaveCount(1);
  expect((await fetch(`${app.url}/api/captures`).then((r) => r.json())).length).toBe(1);
});
