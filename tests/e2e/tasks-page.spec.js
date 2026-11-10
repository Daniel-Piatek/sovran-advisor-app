import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };
const group = (page, name) => page.getByRole('region', { name, exact: true });
const text = (page) => page.getByRole('textbox', { name: 'Text', exact: true });
const noteBody = (app, id) => fetch(`${app.url}/api/notes/${id}`).then((r) => r.json()).then((n) => n.body);

test('a task is under Upcoming; ticked on the Tasks page it is ticked in the note, and back', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Money', body: `- [ ] call the bank @${inDays(3)}` });
  await page.goto(`${app.url}/tasks?view=all`);
  const task = group(page, 'Upcoming').locator('.task-row');
  await expect(task).toHaveCount(1);
  await expect(task).toContainText('call the bank');
  await expect(task.locator('.task-source')).toHaveText('▭Money');
  await task.getByRole('checkbox').click();
  await expect(task).toHaveAttribute('data-checked', 'true');
  await expect(page.getByText('“call the bank” done.')).toBeVisible();
  expect(await noteBody(app, note.id)).toBe(`- [x] call the bank @${inDays(3)}`);

  await task.locator('.task-source').click();
  await expect(page).toHaveURL(new RegExp(`/notes/${note.id}\\?task=0$`));
  await expect(text(page).locator('.task-line')).toHaveAttribute('data-checked', 'true');
  await text(page).getByRole('checkbox').click(); // untick in the note
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.goto(`${app.url}/tasks?view=all`);
  await expect(group(page, 'Upcoming').locator('.task-row')).toHaveAttribute('data-checked', 'false');
});

test('All: Missed, Today, Upcoming and No due date, each with where the task lives', async ({ page, app }) => {
  await app.createNote({ title: 'Home', body: `- [ ] fix the tap\n- [ ] pay rent @${localDay()}\n- [ ] renew insurance @${inDays(-4)}\n- [x] done already` });
  await fetch(`${app.url}/api/people`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Lena Fischer', body: `- [ ] send Lena the deck @${inDays(9)}` }) });
  await fetch(`${app.url}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day: inDays(-1), body: '- [ ] water the plants' }) });
  await page.goto(`${app.url}/tasks?view=all`);
  await expect(page.locator('.task-group-title')).toHaveText(['Missed · 2', 'Today · 1', 'Upcoming · 1', 'No due date · 1']);
  await expect(group(page, 'Missed').locator('.task-words')).toHaveText([/renew insurance/, /water the plants/]);
  await expect(group(page, 'Missed').locator('.task-source')).toHaveText(['▭Home', '31Journal · Yesterday']);
  await expect(group(page, 'Today').locator('.task-words')).toHaveText(['pay rent']); // no chip: the group says it
  await expect(group(page, 'Upcoming').locator('.task-source')).toHaveText('LFLena Fischer');
  await expect(group(page, 'No due date').locator('.task-words')).toHaveText(['fix the tap']);

  await group(page, 'Upcoming').locator('.task-source').click();
  await expect(page).toHaveURL(/\/people\/[0-9a-f-]{36}\?task=0$/);
  await expect(page.locator('.task-line.is-found')).toContainText('send Lena the deck');
});

test('with no open tasks, the page says how to add one', async ({ page, app }) => {
  await page.goto(`${app.url}/tasks`);
  await expect(page.getByText('Nothing for today. Add a task above, or start a line with [] in any note.')).toBeVisible();
});

test('select three tasks with the keyboard and tick them in one go; Undo takes it back', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Errands', body: '- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four' });
  await page.goto(`${app.url}/tasks?view=needs-a-date`);
  const rows = page.locator('.task-row');
  await expect(rows).toHaveCount(4);
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('.task-row[data-selected="true"] .task-words')).toHaveText(['one', 'two', 'three']);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.task-row[data-checked="true"]')).toHaveCount(3);
  await expect(page.getByText('3 tasks done.')).toBeVisible();
  expect(await noteBody(app, note.id)).toBe('- [x] one\n- [x] two\n- [x] three\n- [ ] four');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.task-row[data-checked="true"]')).toHaveCount(0);
  expect(await noteBody(app, note.id)).toBe('- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four');

  // Space ticks the row the keyboard is on; Escape keeps just that one selected.
  await rows.nth(3).click({ position: { x: 2, y: 2 } }); // the row's own edge: no control, no words
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-row[data-selected="true"]')).toHaveCount(1);
  await page.keyboard.press(' ');
  await expect(rows.nth(2)).toHaveAttribute('data-checked', 'true');
  expect(await noteBody(app, note.id)).toBe('- [ ] one\n- [ ] two\n- [x] three\n- [ ] four');
});

test('an unfinished task from a past journal entry moves to today, or another day, in one go', async ({ page, app }) => {
  const post = (body) => fetch(`${app.url}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const entry = await post({ day: inDays(-3), body: '- [ ] renew the insurance\n- [ ] call the dentist' });
  const entryBody = () => fetch(`${app.url}/api/entries/${entry.id}`).then((r) => r.json()).then((e) => e.body);
  await page.goto(`${app.url}/tasks?view=all`);
  const overdue = group(page, 'Missed');
  await overdue.locator('.task-row', { hasText: 'renew the insurance' }).getByRole('button', { name: 'Today' }).click();
  await expect(group(page, 'Today').locator('.task-words')).toHaveText(['renew the insurance']);
  await expect(page.getByText('“renew the insurance” moved to Today.')).toBeVisible();
  expect(await entryBody()).toBe(`- [ ] renew the insurance @${localDay()}\n- [ ] call the dentist`);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(overdue.locator('.task-words')).toHaveText([/renew the insurance/, /call the dentist/]);
  expect(await entryBody()).toBe('- [ ] renew the insurance\n- [ ] call the dentist');

  await overdue.locator('.task-row', { hasText: 'call the dentist' }).getByRole('button', { name: 'Other day' }).click();
  await page.getByLabel('New day for “call the dentist”').fill(inDays(6));
  await expect(group(page, 'Upcoming').locator('.task-words')).toContainText(['call the dentist']);
  expect(await entryBody()).toBe(`- [ ] renew the insurance\n- [ ] call the dentist @${inDays(6)}`);
});

// The right of a row (2026-10-27): Schedule, Home and Written in, three columns on a large
// screen and one small line under the words in a narrower window.
const api = (app, path, method, body) => fetch(`${app.url}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const box = async (locator) => (await locator.boundingBox());
const WIDE = 1360; // where the columns begin (public/style.css)

async function placesData(app) {
  const workshop = await api(app, '/api/life', 'POST', { kind: 'project', title: 'Autumn workshop' });
  const pricing = await api(app, '/api/life', 'POST', { kind: 'topic', title: 'Pricing' });
  await api(app, '/api/tasks', 'POST', { text: 'own with a home', home_id: workshop.id });
  await api(app, '/api/tasks', 'POST', { text: 'own with nothing' });
  const kickoff = await app.createNote({ title: 'Kick-off', body: '- [ ] in a note at home\n- [ ] in a note with its own home' });
  await app.updateNote(kickoff.id, { home_id: workshop.id });
  await app.createNote({ title: 'Loose', body: '- [ ] in a note, no home' });
  const own = (await fetch(`${app.url}/api/tasks`).then((r) => r.json())).find((t) => t.text === 'in a note with its own home');
  await api(app, `/api/tasks/${own.id}`, 'PATCH', { home_id: pricing.id });
}

test('Schedule, Home and Written in are three columns that line up down the page; a task in a note shows its note’s home, and its own home wins', async ({ page, app }) => {
  test.skip(page.viewportSize().width < WIDE, 'columns are for a large screen');
  await placesData(app);
  await page.goto(`${app.url}/tasks?view=needs-a-date`);
  const row = (words) => page.locator('.task-row', { hasText: words });
  await expect(page.locator('.task-row')).toHaveCount(5);

  await expect(row('own with a home').locator('.task-home')).toHaveText('Autumn workshop');
  await expect(row('own with a home').locator('.task-source')).toHaveCount(0); // written in no page
  await expect(row('in a note at home').locator('.task-home')).toHaveText('Autumn workshop'); // its note's home
  await expect(row('in a note at home').locator('.task-source')).toHaveText('▭Kick-off');
  await expect(row('in a note with its own home').locator('.task-home')).toHaveText('Pricing'); // its own wins
  await expect(row('in a note, no home').locator('.task-home')).toHaveCount(0);
  await expect(row('in a note, no home').locator('.task-source')).toHaveText('▭Loose');
  await expect(row('own with nothing').locator('.task-home, .task-source')).toHaveCount(0);

  // The columns have a header, and every row's cells are at the header's places.
  await expect(page.locator('.task-columns-head .task-place')).toHaveText(['Schedule', 'Home', 'Written in']);
  const heads = page.locator('.task-columns-head .task-place');
  const head = [await box(heads.nth(0)), await box(heads.nth(1)), await box(heads.nth(2))];
  for (const words of ['own with nothing', 'own with a home', 'in a note at home', 'in a note with its own home', 'in a note, no home']) {
    const cells = row(words).locator('.task-place');
    const at = [await box(cells.nth(0)), await box(cells.nth(1)), await box(cells.nth(2))];
    expect(at.map((b) => [b.x, b.width]), words).toEqual(head.map((b) => [b.x, b.width]));
  }
  // A link in a column opens its page.
  await row('in a note at home').locator('.task-home').click();
  await expect(page).toHaveURL(/\/life\/[0-9a-f-]{36}$/);
});

test('in a narrower window Schedule, Home and Written in are one small line under the words, Schedule first, with no header', async ({ page, app }) => {
  test.skip(page.viewportSize().width >= WIDE, 'columns are for a large screen');
  await placesData(app);
  await page.goto(`${app.url}/tasks?view=needs-a-date`);
  await expect(page.locator('.task-row')).toHaveCount(5);
  await expect(page.locator('.task-columns-head')).toBeHidden();
  const both = page.locator('.task-row', { hasText: 'in a note at home' });
  const words = await box(both.locator('.task-words'));
  const [schedule, home, written] = [await box(both.locator('.task-schedule')), await box(both.locator('.task-home')), await box(both.locator('.task-source'))];
  expect(schedule.y).toBeGreaterThanOrEqual(words.y + words.height - 1); // under the words
  if (page.viewportSize().width >= 700) { // one line; a phone may wrap Home and Written in under the buttons
    expect(home.y).toBeCloseTo(schedule.y, 0);
    expect(written.y).toBeCloseTo(home.y, 0);
    expect(schedule.x).toBeLessThan(home.x); // Schedule, Home, Written in
    expect(home.x).toBeLessThan(written.x);
  } else {
    expect(home.y).toBeGreaterThanOrEqual(schedule.y);
    expect(written.y + written.x / 1e6).toBeGreaterThanOrEqual(home.y + home.x / 1e6); // reading order
  }
  // A task with neither home nor page has just the Schedule on its small line, not a taller row.
  expect((await box(page.locator('.task-row', { hasText: 'own with nothing' }))).height).toBeLessThanOrEqual((await box(both)).height);
  await expect(page.locator('.task-row', { hasText: 'own with a home' }).locator('.task-source')).toHaveCount(0);
  await expect(page.locator('.task-row', { hasText: 'own with a home' }).locator('.task-home')).toBeVisible();
});


// Schedule (2026-10-27): Today, Other day and Someday on every open task, in every view.
const schedule = (row) => row.locator('.task-schedule');
const chosen = (row) => row.locator('.task-schedule [aria-pressed="true"]');
const entryBody = (app, id) => fetch(`${app.url}/api/entries/${id}`).then((r) => r.json()).then((e) => e.body);
const taskNamed = async (app, words) => (await fetch(`${app.url}/api/tasks`).then((r) => r.json())).find((t) => t.text === words);

test('every open task has Today, Other day and Someday; the one it is at is chosen; a done task has none', async ({ page, app }) => {
  await api(app, '/api/tasks', 'POST', { text: 'due today', due: localDay() });
  await api(app, '/api/tasks', 'POST', { text: 'put off', due: 'someday' });
  await api(app, '/api/tasks', 'POST', { text: 'no day yet', estimate: 10 });
  await api(app, '/api/tasks', 'POST', { text: 'next week', due: inDays(5) });
  await api(app, '/api/tasks', 'POST', { text: 'long gone', due: inDays(-4) });
  await app.createNote({ title: 'Plan', body: `- [ ] in a note @${inDays(2)}\n- [x] finished one` });
  const row = (words) => page.locator('.task-row', { hasText: words });
  const names = ['Today', 'Other day', 'Someday'];
  const buttons = (words) => schedule(row(words)).getByRole('button');

  // Today: Missed and Today groups, Today chosen on today's task only.
  await page.goto(`${app.url}/tasks?view=today`);
  await expect(buttons('due today')).toHaveText(names);
  await expect(chosen(row('due today'))).toHaveText('Today');
  await expect(buttons('long gone')).toHaveText(names); // a missed task too
  await expect(chosen(row('long gone'))).toHaveCount(0);

  await page.goto(`${app.url}/tasks?view=someday`);
  await expect(buttons('put off')).toHaveText(names);
  await expect(chosen(row('put off'))).toHaveText('Someday');

  for (const view of ['upcoming', 'needs-a-date', 'speedies', 'all']) {
    await page.goto(`${app.url}/tasks?view=${view}`);
    const open = page.locator('.task-row[data-checked="false"]');
    await expect(open.first()).toBeVisible();
    for (const one of await open.all()) await expect(schedule(one).getByRole('button')).toHaveText(names);
  }
  await expect(chosen(row('no day yet'))).toHaveCount(0);

  await page.goto(`${app.url}/tasks?view=all&q=in a note`); // search results too
  await expect(buttons('in a note')).toHaveText(names);
  await expect(page.locator('.task-row', { hasText: 'finished one' }).locator('.task-schedule button')).toHaveCount(0); // done: none

  await page.goto(`${app.url}/tasks?view=done`);
  await expect(page.locator('.task-row', { hasText: 'finished one' })).toBeVisible();
  await expect(page.locator('.task-schedule button')).toHaveCount(0);
  // The chosen look is the app's chosen chip (surface and bold), never the accent.
  await page.goto(`${app.url}/tasks?view=someday`);
  const look = await chosen(row('put off')).evaluate((b) => { const c = getComputedStyle(b); return [c.fontWeight, c.backgroundColor, c.boxShadow]; });
  expect(Number(look[0])).toBeGreaterThanOrEqual(600);
  expect(look[1]).not.toBe(await page.locator('.button-primary').evaluate((b) => getComputedStyle(b).backgroundColor));
  expect(look[2]).toBe('none');
});

test('Today, Other day and Someday move a task of its own, with Undo', async ({ page, app }) => {
  await api(app, '/api/tasks', 'POST', { text: 'plan the trip', due: inDays(3) });
  await page.goto(`${app.url}/tasks?view=all`);
  const row = () => page.locator('.task-row', { hasText: 'plan the trip' });
  const due = async () => (await taskNamed(app, 'plan the trip')).due;

  await schedule(row()).getByRole('button', { name: 'Someday' }).click();
  await expect(page.getByText('“plan the trip” moved to Someday.')).toBeVisible();
  expect(await due()).toBe('someday');
  await expect(group(page, 'Someday').locator('.task-words')).toContainText(['plan the trip']);
  await expect(chosen(row())).toHaveText('Someday');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(group(page, 'Upcoming').locator('.task-words')).toContainText(['plan the trip']);
  expect(await due()).toBe(inDays(3));

  await schedule(row()).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByText('“plan the trip” moved to Today.')).toBeVisible();
  expect(await due()).toBe(localDay());
  await expect(chosen(row())).toHaveText('Today');
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await due()).toBe(inDays(3));

  await schedule(row()).getByRole('button', { name: 'Other day' }).click();
  await page.getByLabel('New day for “plan the trip”').fill(inDays(8));
  await expect(group(page, 'Upcoming').locator('.task-words')).toContainText(['plan the trip']);
  expect(await due()).toBe(inDays(8));
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await due()).toBe(inDays(3));

  // The one it is at does nothing when pressed again: no move, no Undo bar.
  await schedule(row()).getByRole('button', { name: 'Someday' }).click();
  await expect(chosen(row())).toHaveText('Someday');
  await page.getByRole('button', { name: 'Undo' }).click();
  await schedule(row()).getByRole('button', { name: 'Someday' }).click();
  await schedule(row()).getByRole('button', { name: 'Someday' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(1);
});

test('Today, Other day and Someday change the @ in a journal entry’s line, and Undo puts it back', async ({ page, app }) => {
  const entry = await api(app, '/api/entries', 'POST', { day: inDays(-3), body: '- [ ] renew the pass\n- [ ] call the venue\n- [ ] book the hall' });
  const original = '- [ ] renew the pass\n- [ ] call the venue\n- [ ] book the hall';
  await page.goto(`${app.url}/tasks?view=all`);
  const row = (words) => page.locator('.task-row', { hasText: words });

  await schedule(row('renew the pass')).getByRole('button', { name: 'Someday' }).click();
  await expect(group(page, 'Someday').locator('.task-words')).toContainText(['renew the pass']);
  expect(await entryBody(app, entry.id)).toBe(`- [ ] renew the pass @someday\n- [ ] call the venue\n- [ ] book the hall`);
  await expect(chosen(row('renew the pass'))).toHaveText('Someday');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(group(page, 'Missed').locator('.task-words')).toHaveText([/renew the pass/, /call the venue/, /book the hall/]);
  expect(await entryBody(app, entry.id)).toBe(original);

  await schedule(row('call the venue')).getByRole('button', { name: 'Today', exact: true }).click();
  await expect(group(page, 'Today').locator('.task-words')).toHaveText(['call the venue']);
  expect(await entryBody(app, entry.id)).toBe(`- [ ] renew the pass\n- [ ] call the venue @${localDay()}\n- [ ] book the hall`);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await entryBody(app, entry.id)).toBe(original);

  await schedule(row('book the hall')).getByRole('button', { name: 'Other day' }).click();
  await page.getByLabel('New day for “book the hall”').fill(inDays(6));
  await expect(group(page, 'Upcoming').locator('.task-words')).toContainText(['book the hall']);
  expect(await entryBody(app, entry.id)).toBe(`- [ ] renew the pass\n- [ ] call the venue\n- [ ] book the hall @${inDays(6)}`);
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await entryBody(app, entry.id)).toBe(original);
});

test('the keys t and m still move the selected task', async ({ page, app }) => {
  await api(app, '/api/tasks', 'POST', { text: 'by key', due: inDays(-1) });
  await page.goto(`${app.url}/tasks?view=today`);
  await page.locator('.task-row', { hasText: 'by key' }).locator('.task-words').click();
  await page.getByRole('button', { name: 'Close' }).click(); // focus is on the row again
  await page.keyboard.press('m');
  await expect.poll(async () => (await taskNamed(app, 'by key')).due).toBe(inDays(1));
  await page.goto(`${app.url}/tasks?view=upcoming`);
  await page.locator('.task-row', { hasText: 'by key' }).focus();
  await page.keyboard.press('t');
  await expect.poll(async () => (await taskNamed(app, 'by key')).due).toBe(localDay());
});

// Closing an open task (2026-10-27): Enter, Escape, Close or a click outside, keeping the words.
test('Enter in the words closes the strip and keeps them; so do a click outside and Escape', async ({ page, app }) => {
  await api(app, '/api/tasks', 'POST', { text: 'first task' });
  await api(app, '/api/tasks', 'POST', { text: 'second task' });
  await page.goto(`${app.url}/tasks?view=needs-a-date`);
  const strip = page.locator('.task-edit');
  const row = (words) => page.locator('.task-row', { hasText: words });

  await row('first task').locator('.task-words').click();
  const words = page.getByLabel('The task’s words');
  await expect(words).toBeFocused();
  await words.fill('first task, renamed');
  await page.keyboard.press('Enter');
  await expect(strip).toHaveCount(0);
  await expect(row('first task, renamed')).toBeFocused(); // focus back on its row
  expect((await taskNamed(app, 'first task, renamed'))?.text).toBe('first task, renamed');

  await row('first task, renamed').locator('.task-words').click();
  await words.fill('first, by a click');
  await page.mouse.click(5, 5); // on the dimmed page around the pop-up
  await expect(strip).toHaveCount(0);
  expect((await taskNamed(app, 'first, by a click'))?.text).toBe('first, by a click');

  await row('first, by a click').locator('.task-words').click();
  await words.fill('first, by Escape');
  await page.keyboard.press('Escape');
  await expect(strip).toHaveCount(0);
  expect((await taskNamed(app, 'first, by Escape'))?.text).toBe('first, by Escape');

  // Cleared words are not saved: the task keeps its words.
  await row('first, by Escape').locator('.task-words').click();
  await words.fill('');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(strip).toHaveCount(0);
  await expect(row('first, by Escape')).toHaveCount(1);
});

test('a click on another task’s words opens that one; the strip of a task in a page closes with Enter on its row or a click outside', async ({ page, app }) => {
  await api(app, '/api/tasks', 'POST', { text: 'one of mine' });
  await app.createNote({ title: 'Plan', body: '- [ ] one in a note' });
  await page.goto(`${app.url}/tasks?view=needs-a-date`);
  const strip = page.locator('.task-edit');
  const row = (words) => page.locator('.task-row', { hasText: words });

  await row('one of mine').locator('.task-words').click();
  await expect(strip).toHaveCount(1);
  await page.getByLabel('The task’s words').fill('one of mine, typed');
  await page.mouse.click(5, 5); // the pop-up is modal: a click beside it closes it, keeping the words
  await expect(strip).toHaveCount(0);
  await expect(row('one of mine, typed')).toHaveCount(1); // the typed words were kept, not lost
  expect((await taskNamed(app, 'one of mine, typed'))?.text).toBe('one of mine, typed');
  await row('one in a note').locator('.task-words').click();
  await expect(strip).toHaveCount(1);
  await expect(strip).toContainText('Its words are changed in its page.');

  await page.mouse.click(5, 5);
  await expect(strip).toHaveCount(0);
  await row('one in a note').locator('.task-words').click();
  await expect(strip).toHaveCount(1);
  await page.getByRole('button', { name: 'Close' }).focus(); // Enter on a button presses it, nothing else
  await row('one in a note').focus();
  await page.keyboard.press('Enter');
  await expect(strip).toHaveCount(0);
  await row('one in a note').focus();
  await page.keyboard.press('Enter');
  await expect(strip).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(strip).toHaveCount(0);
});

test('the Home… picker keeps the strip open: typing, Escape and a pick inside it do not close it', async ({ page, app }) => {
  const pricing = await api(app, '/api/life', 'POST', { kind: 'topic', title: 'Pricing' });
  await api(app, '/api/tasks', 'POST', { text: 'task with a home to pick' });
  await page.goto(`${app.url}/tasks?view=needs-a-date`);
  const strip = page.locator('.task-edit');
  await page.locator('.task-row', { hasText: 'task with a home' }).locator('.task-words').click();
  await strip.getByRole('button', { name: 'Give it a home' }).click();
  const picker = page.locator('.home-picker');
  await expect(picker.getByRole('option', { name: /Pricing/ })).toBeVisible(); // its keys work once My Life has loaded
  await picker.getByLabel('Find a home').fill('pri');
  await picker.getByLabel('Find a home').press('Escape'); // closes the picker only
  await expect(picker).toHaveCount(0);
  await expect(strip).toHaveCount(1);
  await strip.getByRole('button', { name: 'Give it a home' }).click();
  await expect(picker.getByRole('option', { name: /Pricing/ })).toBeVisible();
  await picker.getByLabel('Find a home').click(); // a click in the picker
  await expect(strip).toHaveCount(1);
  await picker.getByLabel('Find a home').press('Enter'); // Enter picks, does not close
  await expect(strip).toHaveCount(1);
  await expect.poll(async () => (await taskNamed(app, 'task with a home to pick')).home?.id).toBe(pricing.id);
  await expect(strip.locator('.home-name')).toHaveText('Pricing');
});
