import { test, expect } from './fixtures.js';

const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const filters = (page) => page.getByRole('group', { name: 'Journals' });
const rows = (page) => page.locator('.entry-list .entry-row');

async function addJournal(page, name) {
  await filters(page).getByRole('button', { name: '+ Journal' }).click();
  await page.getByLabel('New journal name').fill(name);
  await page.getByLabel('New journal name').press('Enter');
  await expect(filters(page).getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
}

test('General is always there, and a new journal can be added', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await expect(filters(page).getByRole('button')).toHaveText(['All', 'General', '+ Journal']);
  await expect(filters(page).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  await addJournal(page, 'Health');
  await expect(filters(page).getByRole('button')).toHaveText(['All', 'General', 'Health', '+ Journal']);
});

// New entry, then the words, then back to the day.
async function write(page, words) {
  await page.getByRole('link', { name: 'New entry' }).click();
  await expect(page.getByRole('textbox', { name: 'Text', exact: true })).toBeFocused();
  await page.keyboard.type(words);
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('link', { name: 'Back to Journal' }).click();
}

test('a Health entry and a General entry today; filtered to Health, only that one shows', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await addJournal(page, 'Health');
  // With Health chosen, New entry writes into Health.
  await page.getByRole('link', { name: 'New entry' }).click();
  await expect(page.getByLabel('Journal', { exact: true })).toHaveValue(/.+/);
  await expect(page.getByLabel('Journal', { exact: true }).locator('option:checked')).toHaveText('Health');
  await page.goBack();
  await write(page, 'Walked 5 km');
  await expect(rows(page)).toHaveCount(1);

  await filters(page).getByRole('button', { name: 'All' }).click();
  await write(page, 'Call with Z');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).locator('.tag')).toHaveText(['Health', 'General']);

  await filters(page).getByRole('button', { name: 'Health' }).click();
  await expect(rows(page).locator('.entry-row-line')).toHaveText(['Walked 5 km']);
  await expect(page).toHaveURL(/\?journal=/);
  await page.reload();
  await expect(rows(page).locator('.entry-row-line')).toHaveText(['Walked 5 km']);
  await filters(page).getByRole('button', { name: 'General' }).click();
  await expect(rows(page).locator('.entry-row-line')).toHaveText(['Call with Z']);
});

test('a new entry goes into General when no journal is chosen; another can be chosen before writing', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await write(page, 'Plain day');
  await expect(rows(page).locator('.tag')).toHaveText(['General']);

  await addJournal(page, 'Health');
  await filters(page).getByRole('button', { name: 'All' }).click();
  await page.getByRole('link', { name: 'New entry' }).click();
  await page.getByLabel('Journal', { exact: true }).selectOption({ label: 'Health' });
  await page.getByRole('textbox', { name: 'Text', exact: true }).click();
  await page.keyboard.type('Slept well');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const entries = await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json();
  expect(entries.map((e) => [e.preview, e.journal_name])).toEqual([['Plain day', 'General'], ['Slept well', 'Health']]);
});

test.describe('names', () => {
  // The browser logs the server's "already exists" answer: that one is expected.
  test.use({ expectedConsoleErrors: [/409 \(Conflict\)/] });

  test('no two journals with the same name', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await addJournal(page, 'Health');
  await filters(page).getByRole('button', { name: '+ Journal' }).click();
  await page.getByLabel('New journal name').fill('health');
  await page.getByLabel('New journal name').press('Enter');
  await expect(page.locator('.journal-tools-message')).toContainText('already a journal');
  });
});

test('deleting a journal moves its entries to General and never deletes them', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await addJournal(page, 'Dreams');
  await write(page, 'Flying over the harbour');
  await filters(page).getByRole('button', { name: 'Dreams' }).click();
  await expect(rows(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'Delete journal' }).click();
  await expect(page.locator('.journal-tools')).toContainText('Its entry moves to General');
  await page.getByRole('button', { name: 'Delete journal' }).click();
  await expect(filters(page).getByRole('button')).toHaveText(['All', 'General', '+ Journal']);
  await expect(rows(page).locator('.tag')).toHaveText(['General']);
  await expect(rows(page).locator('.entry-row-line')).toHaveText(['Flying over the harbour']);
});

test('General cannot be deleted', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await filters(page).getByRole('button', { name: 'General' }).click();
  await expect(page.getByRole('button', { name: 'Delete journal' })).toHaveCount(0);
});

test('an entry can be moved to another journal on its own page', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await addJournal(page, 'Health');
  await filters(page).getByRole('button', { name: 'All' }).click();
  await write(page, 'Actually about sleep');
  await rows(page).click();
  await page.getByLabel('Journal', { exact: true }).selectOption({ label: 'Health' });
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.getByRole('link', { name: 'Back to Journal' }).click();
  await expect(rows(page).locator('.tag')).toHaveText(['Health']);
  const [entry] = await (await fetch(`${app.url}/api/entries?day=${localDay()}`)).json();
  expect(entry.journal_name).toBe('Health');
});
