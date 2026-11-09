import { test, expect, tapAtEnd } from './fixtures.js';

test.describe('search', () => {
  test.beforeEach(async ({ app }) => {
    await app.createNote({ title: 'Onboarding call with Lena', body: 'She lives by the harbour.' });
    await app.createNote({ title: 'Pricing for the workshop', body: 'One price first.' });
    await app.createNote({ title: 'Groceries', body: 'eggs, milk' });
  });

  test('the list shrinks to what matches, as you type', async ({ page, app }) => {
    await page.goto(app.url);
    await expect(page.locator('.note-card')).toHaveCount(3);
    await page.getByLabel('Search notes').pressSequentially('harb');
    await expect(page.locator('.note-card h2')).toHaveText(['Onboarding call with Lena']);
    await expect(page).toHaveURL(`${app.url}/?q=harb`);

    await page.getByLabel('Search notes').fill('price');
    await expect(page.locator('.note-card h2')).toHaveText(['Pricing for the workshop']);

    await page.getByLabel('Search notes').fill('xyz');
    await expect(page.getByText('No notes with “xyz”.')).toBeVisible();

    await page.getByLabel('Search notes').press('Escape');
    await expect(page.locator('.note-card')).toHaveCount(3);
    await expect(page).toHaveURL(`${app.url}/`);
  });

  test('the search is still there after opening a note and coming back', async ({ page, app }) => {
    await page.goto(`${app.url}/?q=milk`);
    await expect(page.getByLabel('Search notes')).toHaveValue('milk');
    await page.locator('.note-card').click();
    await expect(page.getByLabel('Title')).toHaveValue('Groceries');
    await page.goBack();
    await expect(page.getByLabel('Search notes')).toHaveValue('milk');
    await expect(page.locator('.note-card h2')).toHaveText(['Groceries']);
  });

  test('search works in rows too', async ({ page, app }) => {
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Rows' }).click();
    await page.getByLabel('Search notes').fill('lena');
    await expect(page.locator('.note-row')).toHaveCount(1);
  });
});

test('Delete takes a note off the list, and Undo brings it straight back', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Call with Z', body: 'Budget is fixed.' });
  await app.createNote({ title: 'Other note' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await tapAtEnd(page.getByLabel('Text'));
  await page.keyboard.type(' Last words.');
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page).toHaveURL(`${app.url}/`);
  await expect(page.locator('.note-card h2')).toHaveText(['Other note']);
  await expect(page.getByRole('status')).toContainText('“Call with Z” deleted.');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.note-card h2')).toHaveText(['Call with Z', 'Other note']);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

  await page.locator('.note-card', { hasText: 'Call with Z' }).click();
  await expect(page.getByLabel('Text')).toHaveText('Budget is fixed. Last words.');
});

test('a deleted note is not found by search', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Harbour walk' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByLabel('Search notes').fill('harbour');
  await expect(page.getByText('No notes with “harbour”.')).toBeVisible();
});

test('Recently deleted keeps deleted notes, and Restore brings one back whole', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Old pricing idea', body: 'Three tiers.' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No notes yet.')).toBeVisible();

  await page.getByRole('link', { name: 'Recently deleted' }).click();
  await expect(page).toHaveURL(`${app.url}/deleted`);
  await expect(page.getByRole('heading', { name: 'Recently deleted' })).toBeVisible();
  const row = page.locator('.deleted-row', { hasText: 'Old pricing idea' });
  await expect(row).toContainText('deleted just now');
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(row).toContainText('back in your notes');

  await page.getByRole('link', { name: 'Back to Notes' }).click();
  await expect(page.locator('.note-card h2')).toHaveText(['Old pricing idea']);
  await page.locator('.note-card').click();
  await expect(page.getByLabel('Text')).toHaveText('Three tiers.');
});

test('an empty Recently deleted says so', async ({ page, app }) => {
  await page.goto(`${app.url}/deleted`);
  await expect(page.getByText('Nothing here.')).toBeVisible();
});

test('the phone puts the search box on its own row, without spilling sideways', async ({ page, app }) => {
  await app.createNote({ title: 'A note' });
  await page.goto(app.url);
  await expect(page.getByLabel('Search notes')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
