import { test, expect } from './fixtures.js';

const box = (page) => page.getByRole('dialog', { name: 'Quick capture' });
const captureText = (page) => box(page).getByRole('textbox', { name: 'Capture' });
const waiting = async (app) => (await fetch(`${app.url}/api/captures`)).json();

test('while writing a note: ⌘K, a thought, Enter, and back in the note within three seconds', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Workshop plan', body: 'Three tiers.' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await page.getByLabel('Text', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Then');

  const started = Date.now();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(box(page)).toBeVisible();
  await expect(captureText(page)).toBeFocused();
  await page.keyboard.type('Ask Z whether March works');
  await page.keyboard.press('Enter');
  await expect(box(page)).toBeHidden();
  await expect(page.getByLabel('Text', { exact: true })).toBeFocused();
  expect(Date.now() - started).toBeLessThan(3000);

  // Writing goes on where it stopped.
  await page.keyboard.type(' one price.');
  await expect(page.getByLabel('Text', { exact: true })).toHaveText('Three tiers. Then one price.');
  expect((await waiting(app)).map((c) => c.body)).toEqual(['Ask Z whether March works']);
});

test('the Capture button opens the box too; Save keeps the capture with its time', async ({ page, app }) => {
  await page.goto(app.url);
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /Capture/ }).click();
  await page.keyboard.type('Book idea: habits that stick');
  await box(page).getByRole('button', { name: 'Save' }).click();
  await expect(box(page)).toBeHidden();
  const [capture] = await waiting(app);
  expect(capture.body).toBe('Book idea: habits that stick');
  expect(Date.now() - new Date(capture.captured_at)).toBeLessThan(60_000);
});

test('Escape closes without saving, and the text is still there next time', async ({ page, app }) => {
  await page.goto(app.url);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Half a thought');
  await page.keyboard.press('Escape');
  await expect(box(page)).toBeHidden();
  expect(await waiting(app)).toEqual([]);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(captureText(page)).toHaveText('Half a thought');
  await page.keyboard.press('Enter');
  expect((await waiting(app)).map((c) => c.body)).toEqual(['Half a thought']);
});

test('a capture asks nothing: no folder, date or tag in the box', async ({ page, app }) => {
  await page.goto(app.url);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(box(page).locator('select, input')).toHaveCount(0);
  await expect(box(page).getByRole('button')).toHaveText(['Inner', 'Outer', 'Save']);
});

test('the Inbox in the sidebar counts what waits', async ({ page, app }) => {
  await page.goto(app.url);
  const count = page.getByRole('navigation', { name: 'Sections' }).locator('.sidebar-count');
  await expect(count).toBeHidden();
  for (const thought of ['one', 'two', 'three']) {
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type(thought);
    await page.keyboard.press('Enter');
    await expect(box(page)).toBeHidden();
  }
  await expect(count).toHaveText('3');
});

test('Shift-Enter starts a new line, and the slash menu works inside the box', async ({ page, app }) => {
  await page.goto(app.url);
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('Line one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('/quote');
  const menu = page.getByRole('listbox', { name: 'Formatting' });
  await expect(menu).toBeVisible();
  // The menu sits inside the box, where it can be seen and clicked.
  expect(await menu.evaluate((el) => Boolean(el.closest('dialog')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(box(page)).toBeVisible();
});
