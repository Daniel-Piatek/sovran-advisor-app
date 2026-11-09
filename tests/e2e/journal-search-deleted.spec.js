import { test, expect } from './fixtures.js';

const post = async (app, url, body) => (await fetch(app.url + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})).json();

test('search in Notes also finds journal entries, and opens the journal at that day', async ({ page, app }) => {
  await app.createNote({ title: 'Workshop pricing', body: 'One price first.' });
  await post(app, '/api/entries', { day: '2026-10-20', body: 'Walked to the harbour after lunch.' });
  await page.goto(app.url);
  await page.getByLabel('Search notes').fill('walked');
  await expect(page.getByText('No notes with “walked”.')).toBeVisible();
  const journal = page.getByRole('region', { name: 'Journal results' });
  await expect(journal.getByRole('heading', { name: 'Journal' })).toBeVisible();
  await expect(journal.locator('.entry-row-line')).toHaveText(['Walked to the harbour after lunch.']);
  await journal.locator('.entry-row').click();
  await expect(page).toHaveURL(`${app.url}/journal/2026-10-20`);
  await expect(page.locator('.journal-main .journal-section > .entry-list .entry-row-line')).toHaveText(['Walked to the harbour after lunch.']);
});

test('notes come first, then entries; without a search there is no Journal part', async ({ page, app }) => {
  await app.createNote({ title: 'Harbour plans', body: 'A note' });
  await post(app, '/api/entries', { body: 'Sat by the harbour' });
  await page.goto(app.url);
  await expect(page.getByRole('region', { name: 'Journal results' })).toBeHidden();
  await page.getByLabel('Search notes').fill('harb');
  await expect(page.locator('.note-card h2')).toHaveText(['Harbour plans']);
  await expect(page.getByRole('region', { name: 'Journal results' }).locator('.entry-row')).toHaveCount(1);
});

test('Recently deleted holds notes and journal entries, and restores either', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Old idea' });
  const entry = await post(app, '/api/entries', { day: '2026-10-21', body: 'Slept badly' });
  await fetch(`${app.url}/api/notes/${note.id}`, { method: 'DELETE' });
  // Deleted a moment apart, so their order (most recently deleted first) is certain.
  await new Promise((resolve) => setTimeout(resolve, 10));
  await fetch(`${app.url}/api/entries/${entry.id}`, { method: 'DELETE' });

  await page.goto(`${app.url}/deleted`);
  const rows = page.locator('.deleted-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.tag')).toHaveText(['Journal', 'Note']);
  await expect(rows.first()).toContainText('Slept badly');

  await rows.first().getByRole('button', { name: 'Restore' }).click();
  await expect(rows.first()).toContainText('back on');
  await rows.first().getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(`${app.url}/journal/entries/${entry.id}`);
  await expect(page.getByLabel('Text')).toHaveText('Slept badly');

  await page.goto(`${app.url}/deleted`);
  await expect(rows).toHaveCount(1);
  await rows.getByRole('button', { name: 'Restore' }).click();
  await expect(rows).toContainText('back in your notes');
});

test('a journal day links to Recently deleted', async ({ page, app }) => {
  await page.goto(`${app.url}/journal`);
  await page.getByRole('link', { name: 'Recently deleted' }).click();
  await expect(page.getByRole('heading', { name: 'Recently deleted' })).toBeVisible();
});
