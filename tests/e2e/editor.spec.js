import { test, expect } from './fixtures.js';

const savedBody = async (app, id) => (await (await fetch(`${app.url}/api/notes/${id}`)).json()).body;

// The browser tells the editor that the cursor moved (arrow keys, End) a moment later.
// A person never types faster than that; a test can, so it waits for that moment.
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));

async function openNew(page, app, note = { title: 'Formatting' }) {
  const made = await app.createNote(note);
  await page.goto(`${app.url}/notes/${made.id}`);
  await expect(page.getByLabel('Text')).toBeVisible();
  return made;
}

test('**bold** and *italic* turn into formatting as you type, and are saved as Markdown', async ({ page, app }) => {
  const note = await openNew(page, app);
  const text = page.getByLabel('Text');
  await text.click();
  await page.keyboard.type('Three tiers felt like **too many** and *odd*.');
  await expect(text.locator('strong')).toHaveText('too many');
  await expect(text.locator('em')).toHaveText('odd');
  await expect(text).toHaveText('Three tiers felt like too many and odd.');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await savedBody(app, note.id)).toBe('Three tiers felt like **too many** and *odd*.');
});

test('#, ## and - at the start of a line make headings and a list', async ({ page, app }) => {
  const note = await openNew(page, app);
  await page.getByLabel('Text').click();
  await page.keyboard.type('# Plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Next steps');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- one price');
  await page.keyboard.press('Enter');
  await page.keyboard.type('early bird');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. first');

  const text = page.getByLabel('Text');
  await expect(text.locator('h1')).toHaveText('Plan');
  await expect(text.locator('h2')).toHaveText('Next steps');
  await expect(text.locator('ul > li')).toHaveText(['one price', 'early bird']);
  await expect(text.locator('ol > li')).toHaveText(['first']);
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await savedBody(app, note.id)).toBe('# Plan\n\n## Next steps\n\n* one price\n* early bird\n\n1. first');
});

test('Cmd-B and Cmd-I turn bold and italic on and off while typing', async ({ page, app }) => {
  const note = await openNew(page, app, { title: 'Keys' });
  await page.getByLabel('Text').click();
  await page.keyboard.type('plain ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' and ');
  await page.keyboard.press('ControlOrMeta+i');
  await page.keyboard.type('italic');
  await expect(page.getByLabel('Text').locator('strong')).toHaveText('bold');
  await expect(page.getByLabel('Text').locator('em')).toHaveText('italic');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await savedBody(app, note.id)).toBe('plain **bold** and *italic*');
});

test('Backspace straight after takes the formatting back', async ({ page, app }) => {
  await openNew(page, app);
  await page.getByLabel('Text').click();
  await page.keyboard.type('# ');
  await expect(page.getByLabel('Text').locator('h1')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await expect(page.getByLabel('Text').locator('h1')).toHaveCount(0);
  await expect(page.getByLabel('Text')).toHaveText('# ');
});

test('formatting survives a reload, and cards show the words without the signs', async ({ page, app }) => {
  await app.createNote({ title: 'Saved formatting', body: '## Next steps\n\n* **one** price' });
  await page.goto(app.url);
  await expect(page.locator('.note-card p')).toHaveText('Next steps one price');
  await page.locator('.note-card').click();
  await expect(page.getByLabel('Text').locator('h2')).toHaveText('Next steps');
  await expect(page.getByLabel('Text').locator('li strong')).toHaveText('one');
  await expect(page.getByRole('region', { name: 'Info' })).toContainText('4 words');
});

test('a note written before the editor keeps its lines', async ({ page, app }) => {
  await openNew(page, app, { title: 'Plain', body: 'eggs\nmilk\nbread' });
  const lines = await page.getByLabel('Text').evaluate((el) => el.innerText.split('\n').filter(Boolean));
  expect(lines).toEqual(['eggs', 'milk', 'bread']);
});

test('its lines are still separate after editing and reloading', async ({ page, app, isMobile }) => {
  // Shift+Enter is a desktop key. On the phone screen the test browser pretends to be
  // Android, where the editor reads keys the Android way and a made-up Shift+Enter
  // turns into spaces; a real phone keyboard has no Shift+Enter at all.
  test.skip(isMobile, 'Shift+Enter does not exist on a phone keyboard');
  const note = await openNew(page, app, { title: 'Plain', body: 'eggs\nmilk' });
  await page.getByLabel('Text').click();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await settle(page);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('bread');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect.poll(() => page.getByLabel('Text').evaluate((el) => el.innerText.split('\n').filter(Boolean)))
    .toEqual(['eggs', 'milk', 'bread']);
  await page.getByRole('link', { name: 'Back to Notes' }).click();
  await expect(page.locator('.note-card p')).toHaveText('eggs milk bread');
  expect(await savedBody(app, note.id)).toContain('milk');
});

test('clicking the empty space under the text puts the cursor at its end', async ({ page, app }) => {
  await openNew(page, app, { title: 'Plain', body: 'eggs\nmilk' });
  const box = await page.getByLabel('Text').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10);
  await page.keyboard.type('X');
  await expect(page.getByLabel('Text')).toHaveText('eggsmilkX');
});

test('an empty note says Start writing', async ({ page, app }) => {
  await openNew(page, app);
  await expect(page.getByLabel('Text')).toHaveAttribute('data-placeholder', 'Start writing');
  await expect(page.getByLabel('Text')).toHaveClass(/is-empty/);
  // The hint is really drawn, not just set.
  const hint = () => page.getByLabel('Text').evaluate((el) => getComputedStyle(el, '::before').content);
  expect(await hint()).toBe('"Start writing"');
  await page.getByLabel('Text').click();
  await page.keyboard.type('x');
  await expect(page.getByLabel('Text')).not.toHaveClass(/is-empty/);
  expect(await hint()).toBe('none');
});
