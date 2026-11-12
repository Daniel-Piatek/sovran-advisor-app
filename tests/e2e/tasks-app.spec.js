import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };
const allTasks = (app) => fetch(`${app.url}/api/tasks`).then((r) => r.json());

test('q from anywhere: "call the dentist tomorrow ~10m" is a Speedy called "call the dentist" on tomorrow', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // not in the write box
  await page.keyboard.press('q');
  const box = page.getByRole('dialog', { name: 'Add a task' });
  await expect(box).toBeVisible();
  await page.keyboard.type('call the dentist tomorrow ~10m');
  await expect(box.getByLabel('Day')).toHaveValue(inDays(1));
  await expect(box.locator('.quick-chips > *')).toHaveText(['10 min · Speedy']);
  await page.keyboard.press('Enter');
  await expect(box).toBeHidden();
  expect((await allTasks(app)).map((t) => [t.text, t.due, t.estimate, t.source.kind])).toEqual([['call the dentist', inDays(1), 10, 'own']]);
});

test('the q box: chips while typing, a home, and what is said fills the boxes', async ({ page, app }) => {
  const workshop = await fetch(`${app.url}/api/life`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'project', title: 'Autumn workshop' }) }).then((r) => r.json());
  await page.goto(`${app.url}/tasks`);
  await expect(page.getByRole('tablist', { name: 'Views' })).toBeVisible(); // the keys work once the page is drawn
  await page.keyboard.press('q');
  const box = page.getByRole('dialog', { name: 'Add a task' });
  const bar = box.getByRole('textbox', { name: 'Add a task' });
  await expect(bar).toBeFocused();
  await page.keyboard.type('plan the whole workshop day fri ~4h !must 2pm');
  const chips = box.locator('.quick-chips > *');
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toHaveText('4 h · Task');
  await expect(box.getByLabel('Day', { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(box.getByLabel('Flag', { exact: true })).toHaveValue('must');
  await expect(box.getByText('Over three hours: it may be worth splitting into smaller tasks.')).toBeVisible();
  await box.getByRole('button', { name: 'Give it a home' }).click();
  await page.getByRole('option', { name: /Autumn workshop/ }).click();
  await bar.focus();
  await page.keyboard.press('Enter');
  await expect(box).toBeHidden();
  const [task] = await allTasks(app);
  expect([task.text, task.flag, task.estimate, task.home.id, task.reminder.at.slice(11)]).toEqual(['plan the whole workshop day', 'must', 240, workshop.id, '14:00']);
});

test('the Add task pop-up on the Tasks page: title, details, date, flag and home; what the title says fills the boxes left alone', async ({ page, app }) => {
  const workshop = await fetch(`${app.url}/api/life`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'project', title: 'Autumn workshop' }) }).then((r) => r.json());
  await page.goto(`${app.url}/tasks`);
  await expect(page.locator('.tasks-page .quick-add')).toHaveCount(0); // the long add bar is gone
  const modal = page.getByRole('dialog', { name: 'New task' });
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(modal.getByLabel('The task’s words')).toBeFocused();
  await modal.getByLabel('The task’s words').fill('book the kickoff room tomorrow !like ~30m');
  await modal.getByLabel('Details').fill('Ask about the garden room');
  await modal.getByLabel('Date').fill(inDays(3));
  await modal.getByLabel('Flag').selectOption('must');
  await modal.getByRole('button', { name: 'Give it a home' }).click();
  await page.getByRole('option', { name: /Autumn workshop/ }).click();
  await modal.getByRole('button', { name: 'Add task' }).click();
  await expect(modal).toBeHidden();
  const [task] = await allTasks(app);
  // A date and flag chosen in the boxes win over the words.
  expect([task.text, task.details, task.due, task.flag, task.estimate, task.home.id]).toEqual(['book the kickoff room', 'Ask about the garden room', inDays(3), 'must', 30, workshop.id]);

  // On Today the date starts as today, but a day said in the title wins; Enter adds; Escape makes nothing.
  await page.getByRole('button', { name: 'Add task' }).click();
  await modal.getByLabel('The task’s words').fill('call the printer tomorrow');
  await page.keyboard.press('Enter');
  await expect(modal).toBeHidden();
  expect((await allTasks(app)).find((t) => t.text === 'call the printer').due).toBe(inDays(1));
  await page.getByRole('button', { name: 'Add task' }).click();
  await modal.getByLabel('The task’s words').fill('never made');
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  expect((await allTasks(app)).some((t) => t.text === 'never made')).toBe(false);
});

const group = (page, name) => page.getByRole('region', { name, exact: true });
const post = (app, task) => fetch(`${app.url}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) }).then((r) => r.json());

test('the key for Upcoming shows the dentist call; e on it puts it in Done', async ({ page, app }) => {
  await post(app, { text: 'call the dentist', due: inDays(1), estimate: 10 });
  await page.goto(`${app.url}/tasks`);
  await expect(page.getByRole('tab', { name: /^Today/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('2');
  await expect(page).toHaveURL(/\/tasks\?view=upcoming$/);
  const row = group(page, 'Tomorrow').locator('.task-row');
  await expect(row).toContainText('call the dentist');
  await page.keyboard.press('j');
  await expect(row).toBeFocused();
  await page.keyboard.press('e');
  await expect(row).toHaveAttribute('data-checked', 'true');
  await page.keyboard.press('8');
  await expect(page.locator('.task-row .task-words')).toContainText(['call the dentist']);
  await expect(page.locator('.task-row')).toHaveAttribute('data-checked', 'true');
});

test('Missed keeps its old date; the views sort what is open', async ({ page, app }) => {
  await post(app, { text: 'renew the pass', due: inDays(-2) });
  await post(app, { text: 'pay rent', due: localDay() });
  await post(app, { text: 'read about rates', due: 'someday' });
  await post(app, { text: 'reply to Jonas', estimate: 5 });
  await post(app, { text: 'sort the attic' });
  await post(app, { text: 'book the venue', due: inDays(20) });
  await post(app, { text: 'call Lena', due: inDays(3), remind_time: '10:00' });
  await page.goto(`${app.url}/tasks`);
  await expect(page.locator('.task-group-title')).toHaveText(['Missed · 1', 'Today · 1']);
  await expect(group(page, 'Missed').locator('.due-chip').first()).not.toHaveText('Today');
  const words = (view) => page.goto(`${app.url}/tasks?view=${view}`).then(() => page.locator('.task-row .task-words'));
  await expect(await words('upcoming')).toHaveText([/call Lena/, /book the venue/]);
  await expect(page.locator('.task-group-title').last()).toHaveText('Later · 1');
  await expect(await words('speedies')).toHaveText([/reply to Jonas/]);
  await expect(await words('reminders')).toHaveText([/call Lena/]);
  await expect(await words('someday')).toHaveText([/read about rates/]);
  await expect(await words('needs-a-date')).toHaveText([/reply to Jonas/, /sort the attic/]);
  await expect(page.locator('.tab-count')).toHaveText(['2', '2', '1', '1', '1', '2', '7', '1']); // the last is Missed
});

test('x picks rows one by one; t moves them to today and m to tomorrow', async ({ page, app }) => {
  for (const text of ['one', 'two', 'three']) await post(app, { text });
  await page.goto(`${app.url}/tasks?view=needs-a-date`);
  await expect(page.locator('.task-row')).toHaveCount(3);
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('x');
  await expect(page.locator('.task-row[data-selected="true"] .task-words')).toHaveText(['one', 'three']);
  await page.keyboard.press('t');
  await expect(page.getByText('2 tasks moved to Today.')).toBeVisible();
  await expect(page.locator('.task-row .task-words')).toHaveText(['two']);
  await page.keyboard.press('j');
  await page.keyboard.press('m');
  await page.keyboard.press('1');
  await expect(group(page, 'Today').locator('.task-words')).toHaveText(['one', 'three']);
  expect((await allTasks(app)).find((t) => t.text === 'two').due).toBe(inDays(1));
});

test('two tasks for today; flagged Must, one sits at the top of Today with its flag', async ({ page, app }) => {
  await post(app, { text: 'buy stamps', due: localDay() });
  await post(app, { text: 'pay the invoice', due: localDay() });
  await page.goto(`${app.url}/tasks`);
  const rows = group(page, 'Today').locator('.task-row');
  await expect(rows.locator('.task-words')).toHaveText(['buy stamps', 'pay the invoice']);
  await rows.nth(1).hover();
  await rows.nth(1).getByRole('button', { name: 'Flag: none. Change it' }).click();
  await expect(rows.locator('.task-words')).toHaveText(['pay the invoice', 'buy stamps']);
  await expect(rows.first().locator('.flag-chip')).toHaveText('Must');

  // f cycles it: Must → Like → none, and Like comes after Must.
  await rows.nth(1).click({ position: { x: 2, y: 2 } }); // the row's own edge: no words, no Schedule chip
  await page.keyboard.press('f');
  await expect(rows.nth(1).locator('.flag-chip')).toHaveText('Must');
  await page.keyboard.press('f');
  await expect(rows.locator('.flag-chip')).toHaveText(['Must', 'Like']);
  expect((await allTasks(app)).map((t) => [t.text, t.flag])).toEqual([['buy stamps', 'like'], ['pay the invoice', 'must']]);
});

const pad = (n) => String(n).padStart(2, '0');
const minutesAgo = (n) => { const d = new Date(Date.now() - n * 60_000); return [localDay(d), `${pad(d.getHours())}:${pad(d.getMinutes())}`]; };

test('"water the plants every monday 9am", finished: next Monday’s task appears, with its reminder', async ({ page, app }) => {
  await page.goto(`${app.url}/tasks`);
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByLabel('The task’s words').fill('water the plants every monday 9am');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeHidden();
  const [first] = await allTasks(app);
  expect(new Date(`${first.due}T12:00`).getDay()).toBe(1);
  expect(first.reminder.at).toBe(`${first.due}T09:00`);
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('7'); // All
  const row = page.locator('.task-row', { hasText: 'water the plants' });
  await expect(row.locator('.due-chip', { hasText: 'Every monday' })).toBeVisible();
  await row.getByRole('checkbox').click();
  await expect(page.locator('.task-row', { hasText: 'water the plants' })).toHaveCount(2); // the done one, struck, and the next
  const [next] = await allTasks(app);
  const nextMonday = new Date(`${first.due}T12:00`); nextMonday.setDate(nextMonday.getDate() + 7);
  expect([next.text, next.due, next.reminder.at, next.repeat]).toEqual(['water the plants', localDay(nextMonday), `${localDay(nextMonday)}T09:00`, 'every monday']);
});

test('a reminder whose time has come shows a notice: snooze it, or end the alarm (the task stays open)', async ({ page, app }) => {
  const [day, time] = minutesAgo(1);
  await post(app, { text: 'call Lena', due: day, remind_time: time });
  await post(app, { text: 'stretch', due: day, remind_time: time });
  await page.goto(`${app.url}/notes`);
  const notices = page.locator('.notice');
  await expect(notices).toHaveCount(2);
  await expect(notices.first()).toContainText('call Lena');
  await notices.first().getByRole('button', { name: 'Snooze 10 min' }).click();
  await expect(notices).toHaveCount(1);
  await notices.first().getByRole('button', { name: 'Done' }).click();
  await expect(notices).toHaveCount(0);
  expect((await allTasks(app)).map((t) => t.text).sort()).toEqual(['call Lena', 'stretch']); // Done ended the alarm, not the task
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(notices).toHaveCount(0); // snoozed: not again yet; done: never again
});

const life = (app, item) => fetch(`${app.url}/api/life`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) }).then((r) => r.json());

test('a task with a home shows under that Project’s Open tasks, with the tasks of notes at home there', async ({ page, app }) => {
  const onboarding = await life(app, { kind: 'project', title: 'Nordlicht onboarding' });
  const note = await app.createNote({ title: 'Kick-off', body: '- [ ] book the room' });
  await app.updateNote(note.id, { home_id: onboarding.id });
  await page.goto(`${app.url}/tasks`);
  await page.getByRole('button', { name: 'Add task' }).click();
  await page.getByLabel('The task’s words').fill('send the welcome pack fri');
  await page.getByRole('button', { name: 'Give it a home' }).click();
  await page.getByRole('option', { name: /Nordlicht onboarding/ }).click();
  await page.getByRole('button', { name: 'Add task' }).last().click();
  await expect(page.getByRole('dialog', { name: 'New task' })).toBeHidden();

  await page.goto(`${app.url}/life/${onboarding.id}`);
  const open = page.getByRole('region', { name: 'Open tasks' });
  await expect(open.locator('.task-row .task-words')).toHaveText([/send the welcome pack/, /book the room/]);
  await expect(open.locator('.task-row').nth(1).locator('.task-source')).toHaveText('▭Kick-off');
  await open.locator('.task-row').nth(1).getByRole('checkbox').click();
  await expect(open.getByRole('heading')).toHaveText('Open tasks · 1 · 1 done');
  expect(await fetch(`${app.url}/api/notes/${note.id}`).then((r) => r.json()).then((n) => n.body)).toBe('- [x] book the room');

  // A task added here is at home here from the start.
  await open.getByLabel('Add a task').fill('order name badges');
  await page.keyboard.press('Enter');
  await expect(open.locator('.task-row .task-words')).toContainText(['order name badges']);
  expect((await allTasks(app)).find((t) => t.text === 'order name badges').home.id).toBe(onboarding.id);
});

test('a task of its own is renamed and deleted with Undo; a task in a note gets a home of its own', async ({ page, app }) => {
  const pricing = await life(app, { kind: 'topic', title: 'Pricing' });
  await post(app, { text: 'reply to Jonas' });
  await app.createNote({ title: 'Plan', body: '- [ ] read about rates' });
  await page.goto(`${app.url}/tasks?view=needs-a-date`);
  const own = page.locator('.task-row', { hasText: 'reply to Jonas' });
  await own.locator('.task-words').click();
  const words = page.getByLabel('The task’s words');
  await expect(words).toBeFocused();
  await words.fill('reply to Jonas about March');
  await page.keyboard.press('Enter');
  await expect(page.locator('.task-row .task-words')).toContainText(['reply to Jonas about March']);

  await page.locator('.task-row', { hasText: 'reply to Jonas' }).locator('.task-words').click();
  await page.locator('.task-edit').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('“reply to Jonas about March” deleted.')).toBeVisible();
  await expect(page.locator('.task-row', { hasText: 'reply to Jonas' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.task-row', { hasText: 'reply to Jonas' })).toHaveCount(1);

  await page.locator('.task-row', { hasText: 'read about rates' }).locator('.task-words').click();
  await expect(page.locator('.task-edit')).toContainText('Its words are changed in its page.');
  await page.locator('.task-edit').getByRole('button', { name: 'Give it a home' }).click();
  await page.getByRole('option', { name: /Pricing/ }).click();
  await page.getByRole('button', { name: 'Close' }).click(); // what changed is saved as it closes
  await expect.poll(async () => (await allTasks(app)).find((t) => t.text === 'read about rates').home?.id).toBe(pricing.id);

  // Deleted, it waits in Recently deleted.
  await fetch(`${app.url}/api/tasks/${(await allTasks(app)).find((t) => t.text.startsWith('reply')).id}`, { method: 'DELETE' });
  await page.goto(`${app.url}/deleted`);
  const deleted = page.locator('.deleted-row', { hasText: 'reply to Jonas about March' });
  await expect(deleted.locator('.tag')).toHaveText('Task');
  await deleted.getByRole('button', { name: 'Restore' }).click();
  expect((await allTasks(app)).some((t) => t.text === 'reply to Jonas about March')).toBe(true);
});

test('search finds a task by its words, its home or its page, open or done, whatever the view', async ({ page, app }) => {
  const home = await fetch(`${app.url}/api/life`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'project', title: 'Nordlicht onboarding' }) }).then((r) => r.json());
  await post(app, { text: 'Write the offer', due: localDay(), home_id: home.id });
  await post(app, { text: 'Call Jonas about the venue', due: inDays(5) });
  const old = await post(app, { text: 'Send the Nordlicht invoice' });
  await fetch(`${app.url}/api/tasks/${old.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: true }) });
  await app.createNote({ title: 'Venue ideas', body: '- [ ] Ask about the garden room' });
  await page.goto(`${app.url}/tasks`);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  const search = page.getByLabel('Search tasks');
  await expect(search).toBeFocused();
  await page.keyboard.type('nordlicht');
  // Its home's name finds the offer; the invoice is found among the done.
  await expect(page.getByRole('region', { name: 'Found', exact: true }).locator('.task-words')).toHaveText([/Write the offer/]);
  await expect(page.getByRole('region', { name: 'Done', exact: true }).locator('.task-words')).toHaveText([/Send the Nordlicht invoice/]);
  await expect(page.locator('.tab[aria-selected="true"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/tasks\?q=nordlicht$/);
  // Every word counts, and a page's name finds the tasks in it.
  await search.fill('venue');
  await expect(page.getByRole('region', { name: 'Found', exact: true }).locator('.task-words')).toHaveText([/Call Jonas about the venue/, /Ask about the garden room/]);
  await search.fill('venue jonas');
  await expect(page.locator('.task-row .task-words')).toHaveText([/Call Jonas about the venue/]);
  await search.fill('dentist');
  await expect(page.getByText('No task matches “dentist”.')).toBeVisible();
  // Escape empties it and the view is back.
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.getByRole('tab', { name: /^Today/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.task-row .task-words')).toHaveText([/Write the offer/]);
  await expect(page).toHaveURL(/\/tasks$/);
});
