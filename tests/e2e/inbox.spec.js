import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const send = (app, method, url, body) => fetch(app.url + url, {
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
}).then((r) => r.json());
const capture = (app, body) => send(app, 'POST', '/api/captures', { body });
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

// (By class: on a phone the list is out of the page's tree while a capture is open.)
const waiting = (page) => page.locator('nav[aria-label="Waiting"] .inbox-item');
const current = (page) => page.getByRole('textbox', { name: 'Capture text' });
// On a phone the list comes first and a capture is opened by tapping it.
const onPhone = (page) => page.viewportSize().width <= 600;
async function showFirst(page) {
  await expect(page.locator('.inbox-item:visible, [aria-label="Capture text"]:visible').first()).toBeVisible();
  if (onPhone(page) && !(await current(page).isVisible())) await page.locator('.inbox-item').first().click();
  await expect(current(page)).toBeVisible();
}
// Opens the Inbox and waits until the capture to sort is shown, as a person would.
async function openInbox(page, app) {
  await page.goto(`${app.url}/inbox`);
  await showFirst(page);
}
const count = (page) => page.getByRole('navigation', { name: 'Sections' }).locator('.sidebar-count');

test('three captures wait in the Inbox, oldest first, and the sidebar says 3', async ({ page, app }) => {
  await page.goto(app.url);
  for (const thought of ['First thought', 'Second thought', 'Third thought']) {
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type(thought);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeHidden();
  }
  await expect(count(page)).toHaveText('3');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /Inbox/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Inbox · 3');
  await expect(waiting(page).locator('.inbox-item-line')).toHaveText(['First thought', 'Second thought', 'Third thought']);
  // Under each one, the day it was captured, small and muted.
  await expect(waiting(page).first().locator('.inbox-item-when')).toHaveText(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
  await expect(waiting(page).first()).toHaveAttribute('aria-current', 'true');
  await showFirst(page);
  await expect(current(page)).toHaveText('First thought');
});

test('two panels: the list with + Capture (the accent) and the capture with its top bar; + Capture opens the capture box', async ({ page, app }) => {
  await capture(app, 'Panel check');
  await openInbox(page, app);
  const bar = page.locator('.inbox-bar');
  if (!onPhone(page)) await expect(page.locator('.inbox-list-panel')).toBeVisible(); // two panels
  await expect(page.locator('.inbox-current')).toBeVisible();
  await expect(bar).toContainText(/Captured [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, /);
  await expect(bar.getByRole('button', { name: 'Add file' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Edit' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(page.locator('.inbox-kind')).toHaveText('Capture');
  // Accept and the other buttons are not the accent: only + Capture is.
  if (onPhone(page)) await page.getByRole('button', { name: 'Back to the list' }).click();
  const add = page.locator('.top-bar').getByRole('button', { name: 'Capture' });
  await expect(add).toHaveClass(/button-primary/);
  await add.click();
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeVisible();
  await page.keyboard.type('Made from the Inbox');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeHidden();
  await expect(waiting(page).locator('.inbox-item-line')).toHaveText(['Panel check', 'Made from the Inbox']);
});

test('under the suggestion: "Or make it" with A note, A journal entry and A task, and Done and Delete at the right, each with its key', async ({ page, app }) => {
  await capture(app, 'fail-suggest keys');
  await openInbox(page, app);
  const choices = page.getByRole('group', { name: 'Or make it' });
  await expect(choices).toContainText('Or make it');
  await expect(choices.getByRole('button')).toHaveText([/^N\s*A note$/, /^J\s*A journal entry$/, /^T\s*A task$/, /^H\s*Snooze$/, /^D\s*Done$/, /^⌫\s*Delete$/]);
  await expect(choices.getByRole('button', { name: /A note/ })).toHaveAttribute('aria-keyshortcuts', 'N');
  await expect(choices.getByRole('button', { name: /Delete/ })).toHaveAttribute('aria-keyshortcuts', 'Backspace');
  if (!onPhone(page)) { // one line on a large screen, Done and Delete at the right end
    const tops = await choices.getByRole('button').evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const [note, , , , done] = await choices.getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().left));
    expect(done).toBeGreaterThan(note + 300);
  }
  await expect(page.getByRole('heading', { name: 'Sort it' })).toHaveCount(0);
  await choices.getByRole('button', { name: /Done/ }).click();
  await expect(page.getByText('Nothing waits.')).toBeVisible();
});

const inDaysOf = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localDay(d); };

test('J (or the button) opens a line with the words and a day, today; Esc goes back and makes nothing; Enter makes today\'s entry as before', async ({ page, app }) => {
  await capture(app, 'Walked by the harbour\nand thought about the book');
  await openInbox(page, app);
  await page.keyboard.press('j');
  const line = page.locator('.inbox-picker-place');
  await expect(line.getByLabel('The journal entry')).toBeFocused();
  await expect(line.getByLabel('The journal entry')).toHaveValue('Walked by the harbour and thought about the book');
  await expect(line.getByLabel('Day')).toHaveValue(localDay());
  await expect(line).toContainText('Enter makes the entry · Esc goes back');
  await page.keyboard.press('Escape');
  await expect(line.getByLabel('The journal entry')).toHaveCount(0);
  expect(await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json()).toEqual([]);
  expect((await (await fetch(`${app.url}/api/captures/count`)).json()).waiting).toBe(1);
  // The button opens it too; with the words untouched the entry is the capture as it is.
  await page.getByRole('group', { name: 'Or make it' }).getByRole('button', { name: /A journal entry/ }).click();
  await expect(line.getByLabel('The journal entry')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.undo-bar')).toContainText('Added to today’s journal.');
  const [entry] = await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json();
  expect((await (await fetch(`${app.url}/api/entries/${entry.id}`)).json()).body).toBe('Walked by the harbour\nand thought about the book');
});

test('another day for the journal entry: it lands on that day in the Journal', async ({ page, app }) => {
  const day = inDaysOf(-3);
  await capture(app, 'Slept badly, a short walk helped');
  await openInbox(page, app);
  await page.keyboard.press('j');
  await page.locator('.inbox-picker-place').getByLabel('Day').fill(day);
  await page.locator('.inbox-picker-place').getByRole('button', { name: 'Add' }).click();
  await expect(page.locator('.undo-bar')).toContainText('Added to the journal on');
  expect(await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json()).toEqual([]);
  const [entry] = await (await fetch(`${app.url}/api/entries?day=${day}`)).json();
  expect(entry.preview).toBe('Slept badly, a short walk helped');
  const full = await (await fetch(`${app.url}/api/entries/${entry.id}`)).json();
  expect([full.journal_name, full.origin]).toEqual(['General', 'captured']);
  await page.goto(`${app.url}/journal/${day}`);
  await expect(page.locator('.entry-row')).toContainText('Slept badly, a short walk helped');
});

test('the words can be changed on the journal line, and a later day works too', async ({ page, app }) => {
  const day = inDaysOf(2);
  await capture(app, 'tpyo');
  await openInbox(page, app);
  await page.keyboard.press('j');
  const input = page.getByLabel('The journal entry');
  await input.fill('Planned the trip');
  await page.getByLabel('Day').fill(day);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  const [entry] = await (await fetch(`${app.url}/api/entries?day=${day}`)).json();
  expect(entry.preview).toBe('Planned the trip');
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await (await fetch(`${app.url}/api/entries?day=${day}`)).json()).toEqual([]);
  await expect(waiting(page)).toHaveCount(1);
});

test('the top bar: the Home is a bordered box with a house, "No home yet" or the name, and a chevron; the date is small and grey', async ({ page, app }) => {
  await capture(app, 'fail-suggest look');
  await openInbox(page, app);
  const home = page.locator('.inbox-bar .home-dropdown');
  await expect(home).toHaveText('No home yet');
  await expect(home.locator('.icon')).toHaveCount(2); // the house and the chevron
  const box = await home.evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopStyle, s.borderTopWidth]; });
  expect(box).toEqual(['solid', '1px']);
  const edit = await page.locator('.inbox-bar').getByRole('button', { name: 'Edit' }).boundingBox();
  expect((await home.boundingBox()).height).toBeGreaterThanOrEqual(edit.height);
  const when = page.locator('.inbox-when');
  const size = await when.evaluate((el) => [parseFloat(getComputedStyle(el).fontSize), getComputedStyle(el).color === getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted')]);
  expect(size[0]).toBeLessThanOrEqual(14);
  const muted = await page.evaluate(() => { const p = document.createElement('p'); p.style.color = 'var(--color-text-muted)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  expect(await when.evaluate((el) => getComputedStyle(el).color)).toBe(muted);
});

test('clicking another capture in the list opens it', async ({ page, app }) => {
  await capture(app, 'First one');
  await pause();
  await capture(app, 'Second one');
  await openInbox(page, app);
  if (onPhone(page)) await page.getByRole('button', { name: 'Back to the list' }).click();
  await waiting(page).nth(1).click();
  await expect(waiting(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(current(page)).toHaveText('Second one');
  await expect(current(page).locator(':scope > :first-child')).toHaveCSS('font-weight', '400');
  await expect(current(page).locator(':scope > :first-child')).toHaveCSS('font-size', '24px');
  if (onPhone(page)) await page.getByRole('button', { name: 'Back to the list' }).click();
  await expect(waiting(page).nth(1).locator('.inbox-item-line')).toHaveCSS('font-weight', '600');
  await expect(waiting(page).first().locator('.inbox-item-line')).toHaveCSS('font-weight', '400');
});

test('on a phone the list comes first; a capture opens full width, and the arrow goes back', async ({ page, app }) => {
  test.skip(!onPhone(page), 'a phone only');
  await capture(app, 'Phone capture');
  await page.goto(`${app.url}/inbox`);
  await expect(page.locator('.inbox-item')).toBeVisible();
  await expect(current(page)).toBeHidden();
  await page.locator('.inbox-item').click();
  await expect(current(page)).toBeVisible();
  await expect(page.locator('.inbox-item')).toBeHidden();
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await expect(page.locator('.inbox-item')).toBeVisible();
  await expect(current(page)).toBeHidden();
});

test('Edit lets you correct the words, Done goes back; the keys wait while editing', async ({ page, app }) => {
  await capture(app, 'tpyo');
  await openInbox(page, app);
  // Not editable until Edit: the keys work on it.
  await expect(current(page)).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(current(page)).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.type(' fixed');
  await expect(current(page)).toHaveText('tpyo fixed');
  await page.locator('.inbox-bar').getByRole('button', { name: 'Done' }).click();
  await expect(current(page)).toHaveAttribute('contenteditable', 'false');
  await expect.poll(async () => (await (await fetch(`${app.url}/api/captures`)).json())[0].body).toBe('tpyo fixed');
});

test('Delete in the top bar deletes it, with Undo', async ({ page, app }) => {
  await capture(app, 'Gone soon');
  await openInbox(page, app);
  await page.locator('.inbox-bar').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  await expect(page.locator('.undo-bar')).toContainText('Deleted.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(waiting(page)).toHaveCount(1);
  await showFirst(page);
  await expect(current(page)).toHaveText('Gone soon');
});

test('Add file puts the file in the capture, and it is kept with the words', async ({ page, app }) => {
  await capture(app, 'See the attached');
  await openInbox(page, app);
  await page.locator('.inbox-bar input[type=file]').setInputFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('Three tiers.') });
  await expect(page.locator('.inbox-current .file-card')).toContainText('plan.txt');
  await expect.poll(async () => (await (await fetch(`${app.url}/api/captures`)).json())[0].body).toMatch(/\/files\/[0-9a-f]{64}/);
});

test('the top bar\'s Home is saved, opens with the arrow, and is used when the capture becomes a note', async ({ page, app }) => {
  const goal = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Save for the trip' });
  await capture(app, 'Ideas for the trip');
  await openInbox(page, app);
  const bar = page.locator('.inbox-bar');
  await expect(bar.getByRole('link', { name: 'Open the home' })).toBeHidden();
  await bar.getByRole('button', { name: /Give it a home|Home…/ }).click();
  await page.getByRole('option', { name: /Save for the trip/ }).click();
  await expect(bar.getByRole('button', { name: /Home: Save for the trip/ })).toBeVisible();
  await expect.poll(async () => (await (await fetch(`${app.url}/api/captures`)).json())[0].home?.id).toBe(goal.id);
  await bar.getByRole('link', { name: 'Open the home' }).click();
  await expect(page).toHaveURL(new RegExp(`/life/${goal.id}$`));
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Save for the trip'); // drawn
  await page.goBack();
  await showFirst(page);
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  const [note] = await (await fetch(`${app.url}/api/notes`)).json();
  expect((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).home.id).toBe(goal.id);
});

test('J adds it to today\'s journal, remembering the capture; the next one opens at once', async ({ page, app }) => {
  const first = await capture(app, 'Walked by the harbour');
  await pause();
  await capture(app, 'Next one');
  await openInbox(page, app);
  await expect(current(page)).toHaveText('Walked by the harbour');
  await page.keyboard.press('j');
  await expect(page.getByLabel('The journal entry')).toBeFocused(); // asks for its day first
  await page.keyboard.press('Enter');
  await expect(current(page)).toHaveText('Next one');
  await expect(count(page)).toHaveText('1');
  await expect(page.locator('.undo-bar')).toContainText('Added to today’s journal.');
  const [entry] = await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json();
  expect(entry.preview).toBe('Walked by the harbour');
  const full = await (await fetch(`${app.url}/api/entries/${entry.id}`)).json();
  expect([full.capture_id, full.origin]).toEqual([first.id, 'captured']);
});

test('N with Enter makes a new note from it', async ({ page, app }) => {
  const made = await capture(app, 'Pricing idea\nOne price first.');
  await openInbox(page, app);
  await page.keyboard.press('n');
  await expect(page.getByLabel('Find a note')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  const [note] = await (await fetch(`${app.url}/api/notes`)).json();
  expect(note.title).toBe('Pricing idea');
  expect((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).capture_id).toBe(made.id);
});

test('N with a search adds it to a note you find', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Workshop plan', body: 'Three tiers.' });
  await capture(app, 'Ask about the room');
  await openInbox(page, app);
  await page.keyboard.press('n');
  await page.keyboard.type('works');
  await expect(page.getByRole('listbox', { name: 'Notes to add it to' }).getByRole('option', { selected: true })).toHaveText('Workshop plan');
  await page.keyboard.press('Enter');
  await expect(page.locator('.undo-bar')).toContainText('Added to “Workshop plan”.');
  expect((await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).body).toBe('Three tiers.\n\nAsk about the room');
});

test('D marks it done; Backspace lets it go, into Recently deleted', async ({ page, app }) => {
  await capture(app, 'Already did it');
  await pause();
  await capture(app, 'Not needed');
  await openInbox(page, app);
  await page.keyboard.press('d');
  await expect(current(page)).toHaveText('Not needed');
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  await expect(count(page)).toBeHidden();

  await page.goto(`${app.url}/deleted`);
  const row = page.locator('.deleted-row', { hasText: 'Not needed' });
  await expect(row.locator('.tag')).toHaveText('Capture');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(row).toContainText('back in the Inbox');
  await openInbox(page, app);
  await expect(current(page)).toHaveText('Not needed');
});

test('every decision can be undone', async ({ page, app }) => {
  await capture(app, 'Undo me');
  await openInbox(page, app);
  await page.keyboard.press('j');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(current(page)).toHaveText('Undo me');
  await expect(count(page)).toHaveText('1');
  expect(await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json()).toEqual([]);
});

test('the keys wait while you correct the capture', async ({ page, app }) => {
  await capture(app, 'tpyo');
  await openInbox(page, app);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.keyboard.type(' just text with j and d');
  await expect(current(page)).toHaveText('tpyo just text with j and d');
  await expect(count(page)).toHaveText('1');
  // The correction is kept.
  await expect.poll(async () => (await (await fetch(`${app.url}/api/captures`)).json())[0].body).toBe('tpyo just text with j and d');
});

test('the Inbox can be cleared with the keyboard alone', async ({ page, app }) => {
  for (const body of ['one', 'two', 'three', 'four', 'five']) { await capture(app, body); await pause(); }
  await openInbox(page, app);
  const started = Date.now();
  for (const key of ['j', 'd', 'Backspace', 'j']) {
    const before = await current(page).textContent();
    await page.keyboard.press(key);
    if (key === 'j') await page.keyboard.press('Enter'); // the journal line: today, Enter
    await expect(current(page)).not.toHaveText(before);
  }
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);
  expect((await (await fetch(`${app.url}/api/captures/count`)).json()).waiting).toBe(0);
});

test('the buttons do the same as the keys (for a phone)', async ({ page, app }) => {
  await capture(app, 'Tap to sort');
  await openInbox(page, app);
  await page.getByRole('group', { name: 'Or make it' }).getByRole('button', { name: /A journal entry/ }).click();
  await page.locator('.inbox-picker-place').getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('three captures sorted to empty: one a task on tomorrow, one a note, one gone', async ({ page, app }) => {
  for (const body of ['Book the train to Hamburg tomorrow', 'Ideas for the studio name', 'Maybe call about the thing']) { await capture(app, body); await pause(); }
  await openInbox(page, app);
  await expect(count(page)).toHaveText('3');
  await page.keyboard.press('t');
  const bar = page.getByLabel('Add a task');
  await expect(bar).toBeFocused();
  await expect(bar).toHaveValue('Book the train to Hamburg tomorrow');
  // The day the words name shows in the day box.
  await expect(page.locator('.inbox-picker-place').getByLabel('Day')).toHaveValue(inDays(1));
  await page.keyboard.press('Enter');
  await expect(page.getByText('Made a task for Tomorrow.')).toBeVisible();
  await expect(current(page)).toHaveText('Ideas for the studio name');
  await page.keyboard.press('n');
  await page.keyboard.press('Enter');
  await expect(current(page)).toHaveText('Maybe call about the thing');
  await page.keyboard.press('Backspace');
  await expect(page.getByText('Nothing waits.')).toBeVisible();

  const tasks = await (await fetch(`${app.url}/api/tasks`)).json();
  expect(tasks.map((t) => [t.text, t.due, t.capture.body])).toEqual([['Book the train to Hamburg', inDays(1), 'Book the train to Hamburg tomorrow']]);
  await page.goto(`${app.url}/tasks?view=upcoming`);
  const row = page.getByRole('region', { name: 'Tomorrow', exact: true }).locator('.task-row');
  await expect(row).toContainText('Book the train to Hamburg');
  await row.locator('.task-words').click();
  await expect(page.locator('.task-capture')).toContainText('From the Inbox, captured');
  await expect(page.getByLabel('The task’s words')).toHaveValue('Book the train to Hamburg'); // its words are its title; the pop-up does not repeat the capture
});

test('T starts the task at the capture\'s home, and the home goes on the task', async ({ page, app }) => {
  const goal = await send(app, 'POST', '/api/life', { kind: 'goal', title: 'Save for the trip' });
  await capture(app, 'pay the deposit');
  await openInbox(page, app);
  await page.locator('.inbox-bar').getByRole('button', { name: /Give it a home|Home…/ }).click();
  await page.getByRole('option', { name: /Save for the trip/ }).click();
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByRole('button', { name: /A task/ }).click();
  await expect(page.locator('.inbox-picker-place').getByRole('link', { name: /Save for the trip/ })).toBeVisible();
  await page.getByLabel('Add a task').press('Enter');
  await expect(page.getByText(/Made a task/)).toBeVisible();
  const [task] = await (await fetch(`${app.url}/api/tasks`)).json();
  expect(task.home.id).toBe(goal.id);
});

test('a capture made a task can be undone: the task goes, the capture is back', async ({ page, app }) => {
  await capture(app, 'pay the parking fine fri !must');
  await openInbox(page, app);
  await page.keyboard.press('t');
  await expect(page.locator('.inbox-picker-place').getByLabel('Day')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator('.inbox-picker-place').getByLabel('Flag')).toHaveValue('must');
  await page.keyboard.press('Escape'); // back, nothing made
  await expect(page.getByLabel('Add a task')).toHaveCount(0);
  await page.getByRole('button', { name: /A task/ }).click();
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Made a task/)).toBeVisible();
  expect((await (await fetch(`${app.url}/api/tasks`)).json()).map((t) => [t.text, t.flag])).toEqual([['pay the parking fine', 'must']]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(current(page)).toHaveText('pay the parking fine fri !must');
  expect(await (await fetch(`${app.url}/api/tasks`)).json()).toEqual([]);
});

test('H snoozes a capture to tomorrow: it leaves the Inbox; Undo brings it back', async ({ page, app }) => {
  await capture(app, 'Snooze me');
  await pause();
  await capture(app, 'Stay here');
  await openInbox(page, app);
  await page.keyboard.press('h');
  await expect(page.getByRole('group', { name: 'Snooze until' })).toBeVisible();
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await expect(page.getByText(/Snoozed until/)).toBeVisible();
  await expect(waiting(page)).toHaveCount(1);
  await expect(count(page)).toHaveText('1');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(waiting(page)).toHaveCount(2);
});

test('Alt+2 in the capture box makes an Outer World capture: a square, the page title, and the Outer chip shows it alone', async ({ page, app }) => {
  await capture(app, 'My own thought');
  await page.goto(app.url);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('https://example.com/article');
  await page.keyboard.press('Alt+2');
  await expect(page.getByRole('button', { name: 'Outer', exact: true }).last()).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Quick capture' })).toBeHidden();
  await openInbox(page, app);
  const toList = async () => { if (onPhone(page)) await page.getByRole('button', { name: 'Back to the list' }).click(); };
  await toList();
  await expect(waiting(page)).toHaveCount(2);
  const filters = page.getByRole('group', { name: 'Show one world' });
  await filters.getByRole('button', { name: 'Outer' }).click();
  await expect(waiting(page)).toHaveCount(1);
  await waiting(page).first().click();
  await expect(page.getByRole('link', { name: /A page on example.com/ })).toBeVisible();
  await toList();
  await filters.getByRole('button', { name: 'Inner' }).click();
  await expect(waiting(page)).toHaveCount(1);
  await expect(waiting(page).first()).toContainText('My own thought');
  await filters.getByRole('button', { name: 'Inner' }).click();
  await expect(waiting(page)).toHaveCount(2);
});

test('the world of a capture can be changed in the Inbox', async ({ page, app }) => {
  await capture(app, 'Move me');
  await openInbox(page, app);
  const worlds = page.getByRole('group', { name: 'World of this capture' });
  await worlds.getByRole('button', { name: 'Outer' }).click();
  await expect(worlds.getByRole('button', { name: 'Outer' })).toHaveAttribute('aria-pressed', 'true');
  expect((await send(app, 'GET', '/api/captures'))[0].world).toBe('outer');
});
