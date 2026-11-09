import { test, expect, tapAtEnd } from './fixtures.js';

test('New note opens an empty note, ready to type the title', async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Title')).toBeFocused();
  await expect(page.getByLabel('Title')).toHaveAttribute('placeholder', 'Untitled');
});

test('what you type is saved, and the list shows it at the top', async ({ page, app }) => {
  await app.createNote({ title: 'Older note' });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'New note' }).click();

  await page.getByLabel('Title').fill('Pricing for the workshop');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Text')).toBeFocused();
  await page.keyboard.type('Three tiers felt like too many.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await expect(page).toHaveTitle('Pricing for the workshop');

  await page.getByRole('link', { name: 'Back to Notes' }).click();
  await expect(page).toHaveURL(`${app.url}/`);
  await expect(page.locator('.note-card h2')).toHaveText(['Pricing for the workshop', 'Older note']);
  await expect(page.locator('.note-card').first()).toContainText('Three tiers felt like too many.');
});

test('opening a card shows the note, and changes survive a reload', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Call with Z', body: 'Budget is fixed.' });
  await page.goto(app.url);
  await page.locator('.note-card', { hasText: 'Call with Z' }).click();
  await expect(page).toHaveURL(`${app.url}/notes/${note.id}`);
  await expect(page.getByLabel('Title')).toHaveValue('Call with Z');
  await expect(page.getByLabel('Text')).toHaveText('Budget is fixed.');

  await tapAtEnd(page.getByLabel('Text'));
  await page.keyboard.type(' Timing matters.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(page.getByLabel('Text')).toHaveText('Budget is fixed. Timing matters.');
});

test('nothing is lost when you go back straight after typing', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Quick' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByLabel('Text').fill('Typed and gone at once');
  await page.getByRole('link', { name: 'Back to Notes' }).click();
  await expect(page.locator('.note-card').first()).toContainText('Typed and gone at once');
});

test('nothing is lost when the browser back button is used straight after typing', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Back button' });
  await page.goto(app.url);
  await page.locator('.note-card').click();
  await expect(page.getByLabel('Title')).toHaveValue('Back button');
  await page.getByLabel('Text').fill('Still here');
  await page.goBack();
  await expect(page.locator('.note-card').first()).toContainText('Still here');
  await page.goForward();
  await expect(page).toHaveURL(`${app.url}/notes/${note.id}`);
  await expect(page.getByLabel('Text')).toHaveText('Still here');
});

test('nothing is lost when the page is reloaded straight after typing', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Reload' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByLabel('Text').fill('Sent as the page went away');
  await page.reload();
  await expect.poll(async () => (await (await fetch(`${app.url}/api/notes/${note.id}`)).json()).body)
    .toBe('Sent as the page went away');
});

test('the Info section counts words and shows the dates', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Counted', body: 'one two three' });
  await page.goto(`${app.url}/notes/${note.id}`);
  const info = page.getByRole('region', { name: 'Info' });
  await expect(info).toContainText('3 words');
  await expect(info).toContainText('Edited');
  await expect(info).toContainText('just now');
  await tapAtEnd(page.getByLabel('Text'));
  await page.keyboard.type(' four');
  await expect(info).toContainText('4 words');
});

test.describe('a missing note', () => {
  // The browser logs the server's "not found" for the missing note: that one is expected.
  test.use({ expectedConsoleErrors: [/404 \(Not Found\)/] });

  test('a note that does not exist says so', async ({ page, app }) => {
    await page.goto(`${app.url}/notes/00000000-0000-0000-0000-000000000000`);
    await expect(page.getByText("This note doesn't exist, or it was deleted.")).toBeVisible();
    await expect(page.locator('.empty').getByRole('link', { name: 'Recently deleted' })).toHaveAttribute('href', '/deleted');
    await page.getByRole('link', { name: 'Back to Notes' }).click();
    await expect(page.getByText('No notes yet.')).toBeVisible();
  });
});

test('a long note fits a phone without spilling sideways', async ({ page, app }) => {
  const note = await app.createNote({ title: 'A title long enough to wrap onto a second line on a phone', body: 'word '.repeat(400) });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(page.getByLabel('Text')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
