// How words look (2026-11-24, the owner's wish): select words and a bar shows above them (Bold, Italic, Underline,
// Strikethrough, Link, Colour, Highlight); Cmd-U and ~~ as you type; the / menu's Text colour and Highlight colour what is
// typed next. All of it is kept in the Markdown and comes back on reload.
import { test, expect } from './fixtures.js';

const savedBody = async (app, id) => (await (await fetch(`${app.url}/api/notes/${id}`)).json()).body;
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
const text = (page) => page.getByRole('textbox', { name: 'Text' });
const bar = (page) => page.getByRole('toolbar', { name: 'How the words look' });

// Selects the words as a person dragging over them would.
async function select(page, words) {
  await text(page).evaluate((dom, w) => {
    const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const at = walker.currentNode.textContent.indexOf(w);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(walker.currentNode, at);
      range.setEnd(walker.currentNode, at + w.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    throw new Error(`no “${w}”`);
  }, words);
  await settle(page);
}

async function openNote(page, app, body = '') {
  const made = await app.createNote({ title: 'Look', body });
  await page.goto(`${app.url}/notes/${made.id}`);
  await expect(text(page)).toBeVisible();
  return made;
}

test('selected words get a bar: bold, underline, a colour, a highlight and a link, kept on reload', async ({ page, app }) => {
  const note = await openNote(page, app, 'Write about the Tyrant today and see it.');
  await text(page).click();
  await expect(bar(page)).toHaveCount(0); // nothing selected: no bar
  await select(page, 'the Tyrant');
  await expect(bar(page)).toBeVisible();
  await bar(page).getByRole('button', { name: 'Underline' }).click();
  await bar(page).getByRole('button', { name: 'Colour' }).click();
  await expect(bar(page).getByRole('group', { name: 'Text colour' }).locator('.format-swatch')).toHaveCount(12);
  await bar(page).getByRole('button', { name: 'Crimson' }).click();
  await select(page, 'today');
  await bar(page).getByRole('button', { name: 'Highlight' }).click();
  await bar(page).getByRole('button', { name: 'Yellow' }).click();
  await select(page, 'see it');
  await bar(page).getByRole('button', { name: 'Link' }).click();
  await bar(page).getByRole('textbox', { name: 'Link address' }).fill('example.com');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await savedBody(app, note.id)).toBe('Write about [[the Tyrant]{.c-crimson}]{.underline} [today]{.hl-yellow} and [see it](https://example.com).');
  await page.reload();
  await expect(text(page).locator('u .fc-crimson')).toHaveText('the Tyrant');
  await expect(text(page).locator('mark.hl-yellow')).toHaveText('today');
  await expect(text(page).locator('a[href="https://example.com"]')).toHaveText('see it');
  // The bar shows what the words have, and takes it off again.
  await select(page, 'the Tyrant');
  await expect(bar(page).getByRole('button', { name: 'Underline' })).toHaveAttribute('aria-pressed', 'true');
  await bar(page).getByRole('button', { name: 'Colour' }).click();
  await bar(page).getByRole('button', { name: 'No colour' }).click();
  await expect(text(page).locator('.fc-crimson')).toHaveCount(0);
});

test('Cmd-U underlines, ~~ strikes through, and the / menu colours what comes next', async ({ page, app }) => {
  const note = await openNote(page, app);
  await text(page).click();
  await page.keyboard.press('ControlOrMeta+u');
  await page.keyboard.type('under');
  await page.keyboard.press('ControlOrMeta+u');
  await page.keyboard.type(' and ~~gone~~ ');
  await expect(text(page).locator('u')).toHaveText('under');
  await expect(text(page).locator('s')).toHaveText('gone');
  await page.keyboard.type('/colour');
  await expect(page.getByRole('listbox', { name: 'Formatting' }).getByRole('option', { name: 'Text colour', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.getByRole('group', { name: 'Text colour' }).getByRole('button', { name: 'Teal' }).click();
  await page.keyboard.type('teal words');
  await expect(text(page).locator('.fc-teal')).toHaveText('teal words');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await savedBody(app, note.id)).toBe('[under]{.underline} and ~~gone~~ [teal words]{.c-teal}');
});

test('words that only look like the signs stay words', async ({ page, app }) => {
  const note = await openNote(page, app, 'A [note]{.big} and [x]{.c-purple} stay as they are.');
  await expect(text(page)).toHaveText('A [note]{.big} and [x]{.c-purple} stay as they are.');
  await text(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Done');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect(await savedBody(app, note.id)).toBe('A \\[note\\]{.big} and \\[x\\]{.c-purple} stay as they are. Done');
});
