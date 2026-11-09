import { test, expect, newEntry } from './fixtures.js';

const text = (page) => page.getByRole('textbox', { name: 'Text', exact: true });
const tasks = (app) => fetch(`${app.url}/api/tasks`).then((r) => r.json());
const noteBody = (app, id) => fetch(`${app.url}/api/notes/${id}`).then((r) => r.json()).then((n) => n.body);

test('[] at the start of a line makes a task, kept as plain Markdown and as a row', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Call with the bank' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await text(page).click();
  await page.keyboard.type('Next steps');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] Send the form');
  await expect(text(page).locator('.task-line')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ask about the fee');
  await expect(text(page).locator('.task-line .task-words')).toHaveText(['Send the form', 'Ask about the fee']);
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await noteBody(app, note.id)).toBe('Next steps\n\n- [ ] Send the form\n- [ ] Ask about the fee');
  expect((await tasks(app)).map((t) => [t.text, t.source.title])).toEqual([
    ['Send the form', 'Call with the bank'], ['Ask about the fee', 'Call with the bank']]);

  // Ticking in the note ticks the row; Enter on the last empty task ends the list.
  await text(page).getByRole('checkbox', { name: 'Tick when done' }).first().click();
  await expect(text(page).locator('.task-line').first()).toHaveAttribute('data-checked', 'true');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await tasks(app)).map((t) => t.text)).toEqual(['Ask about the fee']);
  await page.reload();
  await expect(text(page).getByRole('checkbox', { name: 'Done. Untick' })).toHaveCount(1);
});

test('the slash menu’s Todo list makes the line a task; Backspace at its start takes the box away', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Plan' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await text(page).click();
  await page.keyboard.type('/todo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Buy tiles');
  await expect(text(page).locator('.task-line .task-words')).toHaveText(['Buy tiles']);
  await page.keyboard.press('Home');
  // Wait until the cursor is really at the start of the line (a busy computer can take
  // more than a frame), then the editor hears of it.
  await expect.poll(() => page.evaluate(() => getSelection().anchorOffset)).toBe(0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await page.keyboard.press('Backspace');
  await expect(text(page).locator('.task-line')).toHaveCount(0);
  await expect(text(page).locator('li')).toHaveText(['Buy tiles']);
});

test('a My Life thinking space keeps [] as plain text', async ({ page, app }) => {
  const item = await fetch(`${app.url}/api/life`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'topic', title: 'Pricing' }),
  }).then((r) => r.json());
  await page.goto(`${app.url}/life/${item.id}`);
  await page.getByLabel('Thinking space').click();
  await page.keyboard.type('[] not a task');
  await expect(page.getByLabel('Thinking space').locator('.task-line')).toHaveCount(0);
  await page.keyboard.type(' /todo');
  await expect(page.getByRole('option', { name: /Todo list/ })).toHaveCount(0);
});

const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const nextFriday = () => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return localDay(d); };

test('"[] call the bank @friday" is a task due Friday', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Money' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await text(page).click();
  await page.keyboard.type('[] call the bank @friday');
  const first = page.getByRole('listbox', { name: 'Link to' }).getByRole('option').first();
  await expect(first).toContainText('Friday');
  await expect(first).toContainText('due');
  await page.keyboard.press('Enter');
  await expect(text(page).locator('.task-line .due-chip')).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await noteBody(app, note.id)).toBe(`- [ ] call the bank @${nextFriday()} `); // the space after the chip, to go on writing
  expect((await tasks(app)).map((t) => [t.text, t.due])).toEqual([['call the bank', nextFriday()]]);

  // A space after the date words does it too; a name stays a mention.
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('pay rent @tomorrow later');
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  await expect(text(page).locator('.task-line').nth(1).locator('.due-chip')).toHaveText('Tomorrow');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await tasks(app)).map((t) => [t.text, t.due])).toEqual( // soonest first
    [['call the bank', nextFriday()], ['pay rent later', localDay(tomorrow)]].sort((x, y) => x[1].localeCompare(y[1])));
  await page.reload();
  await expect(text(page).locator('.due-chip')).toHaveCount(2);
});

test('outside a task, @ is only for people', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Plain' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await text(page).click();
  await page.keyboard.type('Meet @fri');
  await expect(page.getByRole('listbox', { name: 'Link to' }).getByRole('option')).toHaveText(['+New person “fri”']);
  await page.keyboard.press('Escape');
  await page.keyboard.type('day ');
  await expect(text(page).locator('.due-chip')).toHaveCount(0);
});

test('a task in a journal entry is due that day', async ({ page, app }) => {
  await newEntry(page, app);
  await page.keyboard.type('[] water the plants');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await tasks(app)).map((t) => [t.text, t.due, t.source.kind])).toEqual([['water the plants', localDay(new Date()), 'entry']]);
});
