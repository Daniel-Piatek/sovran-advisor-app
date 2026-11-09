import { test, expect, newEntry } from './fixtures.js';

const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const menu = (page) => page.getByRole('listbox', { name: 'Link to' });
// The editor learns where End put the cursor a moment later (see tests/e2e/editor.spec.js).
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
const text = (page) => page.getByRole('textbox', { name: 'Text', exact: true });

test('[[ in today\'s journal links a note; rename the note, and the link still opens it', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Workshop plan', body: 'Three tiers.' });
  await newEntry(page, app);
  await page.keyboard.type('Call went well. Next: [[work');
  await expect(menu(page).getByRole('option').first()).toContainText('Workshop plan');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type('.');
  await expect(text(page).locator('.page-link')).toContainText('Workshop plan');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const [entry] = await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json();
  expect(entry.preview).toBe(`Call went well. Next: [Workshop plan](/notes/${note.id}).`);

  await app.updateNote(note.id, { title: 'Autumn workshop' });
  await page.goto(`${app.url}/journal/entries/${entry.id}`);
  const link = text(page).locator('.page-link');
  await expect(link).toContainText('Autumn workshop');
  await link.click();
  await expect(page).toHaveURL(`${app.url}/notes/${note.id}`);
  await expect(page.getByLabel('Title')).toHaveValue('Autumn workshop');
});

test('suggestions offer entries and days too, and Escape keeps what was typed', async ({ page, app }) => {
  await fetch(`${app.url}/api/entries`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Accountant call', body: 'fine', day: '2026-10-20' }),
  });
  const note = await app.createNote({ title: 'Plan' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await text(page).click();
  await page.keyboard.type('See [[accountant');
  await expect(menu(page).getByRole('option').first()).toContainText('Accountant call');
  await expect(menu(page).getByRole('option').first()).toContainText('journal entry');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(text(page)).toHaveText('See [[accountant');

  await page.keyboard.type(' and [[yester');
  await expect(menu(page).getByRole('option').first()).toContainText('Yesterday');
  await page.keyboard.press('Enter');
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  await expect(text(page).locator('.page-link')).toHaveAttribute('href', `/journal/${localDay(yesterday)}`);
  await expect(page.getByRole('status')).toHaveText('Saved');
});

test('"New note …" makes the note and links to it', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Pricing thoughts' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await text(page).click();
  await page.keyboard.type('Ask in [[Questions for the accountant');
  const last = menu(page).getByRole('option').last();
  await expect(last).toHaveText(/New note “Questions for the accountant”/);
  await page.keyboard.press('ArrowUp');
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(text(page).locator('.page-link')).toContainText('Questions for the accountant');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const notes = await (await fetch(`${app.url}/api/notes`)).json();
  expect(notes.map((n) => n.title)).toContain('Questions for the accountant');
});

test('⌘-click on a link opens the page in a new tab', async ({ page, app, context }) => {
  const target = await app.createNote({ title: 'Target' });
  const note = await app.createNote({ title: 'Source', body: `See [Target](/notes/${target.id}).` });
  await page.goto(`${app.url}/notes/${note.id}`);
  const opened = context.waitForEvent('page');
  await text(page).locator('.page-link').click({ modifiers: ['ControlOrMeta'] });
  const tab = await opened;
  await tab.waitForURL(`${app.url}/notes/${target.id}`);
  await expect(page).toHaveURL(`${app.url}/notes/${note.id}`);
  await tab.close();
});

test('a link to a deleted page says so', async ({ page, app }) => {
  const target = await app.createNote({ title: 'Gone soon' });
  const note = await app.createNote({ title: 'Source', body: `See [Gone soon](/notes/${target.id}).` });
  await fetch(`${app.url}/api/notes/${target.id}`, { method: 'DELETE' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(text(page).locator('.page-link')).toHaveClass(/is-missing/);
});

test('a link counts as one piece: Backspace takes it out whole, and nothing else changes', async ({ page, app }) => {
  const target = await app.createNote({ title: 'Target' });
  const note = await app.createNote({ title: 'Source', body: `See [Target](/notes/${target.id})` });
  await page.goto(`${app.url}/notes/${note.id}`);
  await text(page).click();
  await page.keyboard.press('End');
  await settle(page);
  await page.keyboard.press('Backspace');
  await expect(text(page).locator('.page-link')).toHaveCount(0);
  await expect(text(page)).toHaveText('See ');
});
