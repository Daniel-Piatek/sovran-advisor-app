import { test, expect } from './fixtures.js';

const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme ?? 'light');

test('the app starts light, and the switch at the bottom turns it dark and back', async ({ page, app }) => {
  await page.goto(app.url);
  const switchGroup = page.getByRole('group', { name: 'Theme' });
  await expect(switchGroup.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
  expect(await theme(page)).toBe('light');
  const light = await background(page);

  await switchGroup.getByRole('button', { name: 'Dark' }).click();
  await expect(switchGroup.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  expect(await theme(page)).toBe('dark');
  expect(await background(page)).not.toBe(light);

  await switchGroup.getByRole('button', { name: 'Light' }).click();
  expect(await theme(page)).toBe('light');
  expect(await background(page)).toBe(light);
});

test('the switch is the last thing on every screen', async ({ page, app }) => {
  const note = await app.createNote({ title: 'A note', body: 'Text' });
  for (const path of ['/', `/notes/${note.id}`]) {
    await page.goto(app.url + path);
    await expect(page.locator('.note-card, .note-info').first()).toBeVisible();
    const last = await page.evaluate(() => document.getElementById('app').lastElementChild.getAttribute('class'));
    expect(last, path).toBe('page-footer');
    await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible();
  }
});

test('dark is remembered, and is on before the page is drawn', async ({ page, app }) => {
  const note = await app.createNote({ title: 'A note' });
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Dark' }).click();

  // Read the theme as early as the page lets a script run, before the app draws anything.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      window.themeWhenParsed = document.documentElement.dataset.theme ?? 'light';
    });
  });
  await page.goto(`${app.url}/notes/${note.id}`);
  expect(await page.evaluate(() => window.themeWhenParsed)).toBe('dark');
  await expect(page.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('link', { name: 'Back to Notes' }).click();
  expect(await theme(page)).toBe('dark');
});
