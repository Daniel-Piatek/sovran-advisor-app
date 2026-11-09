import { test, expect } from './fixtures.js';

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

test('an empty list says so and offers New note', async ({ page, app }) => {
  await page.goto(app.url);
  await expect(page.getByText('No notes yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
});

test('notes show as cards, last edited first, with title and first lines', async ({ page, app }) => {
  const pricing = await app.createNote({ title: 'Pricing for the workshop', body: 'Three tiers felt like too many.' });
  await pause();
  await app.createNote({ title: 'Call with Z', body: 'Budget is fixed until March.' });
  await pause();
  await app.createNote({ title: '', body: 'Idea on the walk' });
  await pause();
  await app.updateNote(pricing.id, { body: 'Three tiers felt like too many. One price first.' });

  await page.goto(app.url);
  const cards = page.locator('.note-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.locator('h2')).toHaveText(['Pricing for the workshop', 'Untitled', 'Call with Z']);
  await expect(cards.first()).toContainText('One price first.');
  await expect(cards.first()).toHaveAttribute('href', `/notes/${pricing.id}`);
});

test('the switch shows rows, and the choice is remembered', async ({ page, app }) => {
  await app.createNote({ title: 'Call with Z', body: 'Budget is fixed.\nTiming matters.' });
  await page.goto(app.url);
  const grid = page.getByRole('button', { name: 'Grid' });
  const rows = page.getByRole('button', { name: 'Rows' });
  await expect(grid).toHaveAttribute('aria-pressed', 'true');

  await rows.click();
  await expect(rows).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.note-row')).toHaveCount(1);
  await expect(page.locator('.note-card')).toHaveCount(0);
  await expect(page.locator('.note-row')).toContainText('Budget is fixed. Timing matters.');

  await page.reload();
  await expect(page.locator('.note-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Grid' }).click();
  await page.reload();
  await expect(page.locator('.note-card')).toHaveCount(1);
});

test('a note\'s text is shown as text, never run as code', async ({ page, app }) => {
  await app.createNote({ title: '<img src=x onerror="window.ran=1">', body: '<b>not bold</b>' });
  await page.goto(app.url);
  await expect(page.locator('.note-card h2')).toHaveText('<img src=x onerror="window.ran=1">');
  await expect(page.locator('.note-card p')).toHaveText('<b>not bold</b>');
  expect(await page.evaluate(() => window.ran)).toBeUndefined();
});

test('many notes fit the screen without spilling sideways', async ({ page, app }) => {
  for (let i = 1; i <= 7; i++) {
    await app.createNote({ title: `Note ${i} with a rather long title that has to wrap somewhere`, body: 'word '.repeat(80) });
  }
  for (const view of ['Grid', 'Rows']) {
    await page.goto(app.url);
    await page.getByRole('button', { name: view }).click();
    await expect(page.locator('.note-card, .note-row')).toHaveCount(7);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, view).toBeLessThanOrEqual(0);
  }
});
