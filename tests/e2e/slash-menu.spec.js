import { test, expect } from './fixtures.js';

const savedBody = async (app, id) => (await (await fetch(`${app.url}/api/notes/${id}`)).json()).body;

async function openNote(page, app, note = { title: 'Menu' }) {
  const made = await app.createNote(note);
  await page.goto(`${app.url}/notes/${made.id}`);
  await page.getByLabel('Text').click();
  return made;
}

const menu = (page) => page.getByRole('listbox', { name: 'Formatting' });
const option = (page, name) => menu(page).getByRole('option', { name, exact: true });

test('/ opens the menu, with later options greyed out', async ({ page, app }) => {
  await openNote(page, app);
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type('/');
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('option')).toHaveCount(28);
  await expect(option(page, 'Text')).toHaveAttribute('aria-selected', 'true');
  await expect(menu(page).getByRole('option', { name: /^Card/ })).toHaveAttribute('aria-disabled', 'true');
  await expect(menu(page).getByRole('option', { name: /^Card/ })).toContainText('later');
  await expect(option(page, 'Heading 1')).not.toHaveAttribute('aria-disabled', 'true');
});

test('typing filters it, the arrows move, Enter chooses, and the /words go', async ({ page, app }) => {
  const note = await openNote(page, app);
  await page.keyboard.type('/head');
  await expect(menu(page).locator('.slash-menu-label')).toHaveText(
    ['Heading 1', 'Heading 2', 'Heading 3', 'Toggle heading 1', 'Toggle heading 2', 'Toggle heading 3']);
  await page.keyboard.press('ArrowDown');
  await expect(option(page, 'Heading 2')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type('Next steps');
  await expect(page.getByLabel('Text').locator('h2')).toHaveText('Next steps');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await savedBody(app, note.id)).toBe('## Next steps');
});

test('filtering matches the start of words, like Heptabase', async ({ page, app }) => {
  await openNote(page, app);
  await page.keyboard.type('/li');
  await expect(menu(page).locator('.slash-menu-label')).toHaveText(
    ['Card', 'Todo list', 'Bullet list', 'Number list', 'Toggle list', 'Divider']);
  await page.keyboard.type('st');
  await expect(menu(page).locator('.slash-menu-label')).toHaveText(['Todo list', 'Bullet list', 'Number list', 'Toggle list']);
  await page.keyboard.press('Escape');
  await page.keyboard.type(' /head 2');
  await expect(menu(page).locator('.slash-menu-label')).toHaveText(['Heading 2', 'Toggle heading 2']);
});

test('the arrows skip options that come later', async ({ page, app }) => {
  await openNote(page, app);
  await page.keyboard.type('/');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(option(page, 'Heading 3')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown'); // Card is still to come and is skipped; Whiteboard works in a note (Writing and thinking)
  await expect(option(page, 'Whiteboard')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown'); // Highlight comes later and is skipped
  await expect(option(page, 'Date')).toHaveAttribute('aria-selected', 'true');
});

test('a click chooses too, and a later option does nothing', async ({ page, app }) => {
  await openNote(page, app);
  await page.keyboard.type('/');
  // A greyed-out option is marked disabled, so the click has to be forced to try it.
  await menu(page).getByRole('option', { name: /^Toggle list/ }).click({ force: true });
  await expect(menu(page)).toBeVisible();
  await option(page, 'Bullet list').click();
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type('one price');
  await expect(page.getByLabel('Text').locator('ul > li')).toHaveText(['one price']);
});

test('Escape closes the menu and keeps what was typed', async ({ page, app }) => {
  await openNote(page, app);
  await page.keyboard.type('/he');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type('llo');
  await expect(page.getByLabel('Text')).toHaveText('/hello');
});

test('a / inside a word does not open it', async ({ page, app }) => {
  await openNote(page, app);
  await page.keyboard.type('and/or');
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type(' then /');
  await expect(menu(page)).toBeVisible();
});

test('with nothing matching it says so, and Enter just starts a new line', async ({ page, app }) => {
  await openNote(page, app);
  await page.keyboard.type('/zzz');
  await expect(menu(page)).toContainText('No options');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toBeHidden();
  await page.keyboard.type('next line');
  await expect(page.getByLabel('Text').locator('p')).toHaveText(['/zzz', 'next line']);
});

test('Date, Divider, Quote and Code block do what they say', async ({ page, app }) => {
  const note = await openNote(page, app);
  await page.keyboard.type('/date');
  await page.keyboard.press('Enter');
  const today = await page.evaluate(() => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
  await expect(page.getByLabel('Text')).toHaveText(today);

  await page.keyboard.press('Enter');
  await page.keyboard.type('/divider');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Text').locator('hr')).toHaveCount(1);
  await page.keyboard.type('/quote');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Keep it small.');
  await expect(page.getByLabel('Text').locator('blockquote')).toHaveText('Keep it small.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await savedBody(app, note.id)).toBe(`${today}\n\n---\n\n> Keep it small.`);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/code');
  await page.keyboard.press('Enter');
  await page.keyboard.type('npm start');
  await expect(page.getByLabel('Text').locator('pre')).toHaveText('npm start');
});

test('the menu opens under the "/" and stays inside the screen', async ({ page, app }) => {
  await openNote(page, app, { title: 'Menu', body: 'word '.repeat(30) });
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.type(' /');
  await expect(menu(page)).toBeVisible();
  const box = await menu(page).boundingBox();
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('leaving the note closes the menu', async ({ page, app }) => {
  await openNote(page, app);
  await page.keyboard.type('/');
  await expect(menu(page)).toBeVisible();
  await page.getByLabel('Title').click();
  await expect(menu(page)).toBeHidden();
  await page.getByRole('link', { name: 'Back to Notes' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
});
