import { test, expect, newEntry } from './fixtures.js';

const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addEntry = async (app, entry) => (await fetch(`${app.url}/api/entries`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry),
})).json();
const pane = (page) => page.getByRole('region', { name: 'Linked from' });

test('the note you linked from today\'s journal lists it under Linked from, with the sentence', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Workshop plan' });
  await newEntry(page, app);
  await page.keyboard.type('Call went well. Next: [[workshop');
  await expect(page.getByRole('listbox', { name: 'Link to' }).getByRole('option').first()).toContainText('Workshop plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' and the room.');
  await expect(page.getByRole('status')).toHaveText('Saved');

  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(pane(page).getByRole('heading')).toHaveText('Linked from · 1');
  const row = pane(page).locator('.linked-from-row');
  await expect(row).toContainText('Journal ·');
  await expect(row.locator('.linked-from-context')).toHaveText('Next: Workshop plan and the room.');
  await expect(row.locator('.linked-from-context strong')).toHaveText('Workshop plan');
  await row.click();
  await expect(page).toHaveURL(/\/journal\/entries\//);
});

test('Linked from on a note, an entry and a day; a page with none says so', async ({ page, app }) => {
  const entry = await addEntry(app, { title: 'Morning', body: 'Walked' });
  const target = await app.createNote({ title: 'Target' });
  await app.createNote({ title: 'Week review', body: `Good: [Morning](/journal/entries/${entry.id}), [Target](/notes/${target.id}) and [today](/journal/${localDay()}).` });

  await page.goto(`${app.url}/journal/entries/${entry.id}`);
  await expect(pane(page).locator('.linked-from-source')).toHaveText(['▭Week review']);
  await page.goto(`${app.url}/journal`);
  await expect(pane(page).locator('.linked-from-source')).toHaveText(['▭Week review']);
  await page.goto(`${app.url}/notes/${target.id}`);
  await expect(pane(page).locator('.linked-from-context strong')).toHaveText('Target');

  const lonely = await app.createNote({ title: 'Nobody links here' });
  await page.goto(`${app.url}/notes/${lonely.id}`);
  await expect(pane(page)).toContainText('Nothing links here yet.');
});

test('taking a link out of the text takes it off Linked from', async ({ page, app }) => {
  const target = await app.createNote({ title: 'Target' });
  const source = await app.createNote({ title: 'Source', body: `See [Target](/notes/${target.id})` });
  await app.updateNote(source.id, { body: 'No link now.' });
  await page.goto(`${app.url}/notes/${target.id}`);
  await expect(pane(page)).toContainText('Nothing links here yet.');
});

test('a renamed note shows its new name in links you come back to', async ({ page, app }) => {
  const target = await app.createNote({ title: 'Old name' });
  const source = await app.createNote({ title: 'Source', body: `See [Old name](/notes/${target.id}).` });
  await page.goto(`${app.url}/notes/${source.id}`);
  await expect(page.getByRole('textbox', { name: 'Text', exact: true }).locator('.page-link')).toContainText('Old name');
  await page.getByRole('textbox', { name: 'Text', exact: true }).locator('.page-link').click();
  await page.getByLabel('Title').fill('New name');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true }).locator('.page-link')).toContainText('New name');
});
