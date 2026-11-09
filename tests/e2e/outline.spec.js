// The outliner (advanced/writing/1): nest, fold, move, zoom. The text stays plain indented Markdown.
import { test, expect, tapAtEnd } from './fixtures.js';

const BODY = 'Intro line\n\n* Format\n  * One exercise\n  * Two exercises\n* Agenda\n  * Talks\n* Venue';
const text = (page) => page.getByLabel('Text');
const noteOf = (app, id) => fetch(`${app.url}/api/notes/${id}`).then((r) => r.json());
const settle = (page) => page.waitForTimeout(150);

async function open(page, app, body = BODY) {
  const note = await app.createNote({ title: 'Ideas for the autumn workshop', body });
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(text(page)).toContainText('Intro line');
  return note;
}

test('a bullet with bullets under it has a triangle; folding hides them, is not an edit, and is still folded after a reload', async ({ page, app }) => {
  const note = await open(page, app);
  const toggles = page.locator('.fold-toggle');
  await expect(toggles).toHaveCount(2); // Format and Agenda; Venue has nothing under it
  const box = await toggles.first().boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); // on a phone too, it is on the screen
  await expect(text(page).getByText('One exercise')).toBeVisible();
  const before = await noteOf(app, note.id);
  await page.waitForTimeout(1100); // so a changed edited time would show
  await toggles.first().click();
  await expect(text(page).getByText('One exercise')).toBeHidden();
  await expect.poll(async () => (await fetch(`${app.url}/api/notes/${note.id}/bullets`).then((r) => r.json())).blocks.some((b) => b.folded)).toBe(true);
  await expect(text(page).getByText('Talks')).toBeVisible(); // only that one
  await expect(toggles.first()).toHaveAttribute('aria-expanded', 'false');
  await page.waitForTimeout(800);
  const after = await noteOf(app, note.id);
  expect([after.body, after.updated_at]).toEqual([before.body, before.updated_at]); // not an edit

  await page.reload();
  await expect(text(page).getByText('Two exercises')).toBeHidden();
  await expect(text(page).getByText('Talks')).toBeVisible();
  await page.locator('.fold-toggle').first().click(); // open it again
  await expect(text(page).getByText('Two exercises')).toBeVisible();
  await expect.poll(async () => (await fetch(`${app.url}/api/notes/${note.id}/bullets`).then((r) => r.json())).blocks.some((b) => b.folded)).toBe(false);
  await page.reload();
  await expect(text(page).getByText('Two exercises')).toBeVisible();
});

test('Tab nests a bullet with its children, Shift Tab lifts it; the text is a plain indented list that survives a reload', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Nest', body: '* one' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await tapAtEnd(text(page));
  await page.keyboard.press('Enter');
  await page.keyboard.type('two');
  await page.keyboard.press('Enter');
  await page.keyboard.type('three');
  await settle(page);
  await page.keyboard.press('Tab'); // three under two
  await settle(page);
  await page.keyboard.press('ArrowUp');
  await settle(page);
  await page.keyboard.press('Tab'); // two (with three) under one
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await noteOf(app, note.id)).body).toBe('* one\n  * two\n    * three');
  const tree = (await fetch(`${app.url}/api/notes/${note.id}/bullets`).then((r) => r.json())).blocks;
  expect(tree.map((b) => [b.text, b.depth, b.children])).toEqual([['one', 0, 1], ['two', 1, 1], ['three', 2, 0]]);
  expect(tree[2].parent_id).toBe(tree[1].id);

  await page.keyboard.press('Shift+Tab'); // two back out, three with it
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await noteOf(app, note.id)).body).toBe('* one\n* two\n  * three');
  await page.reload();
  await expect(text(page)).toHaveText('onetwothree');
  await expect(page.locator('.fold-toggle')).toHaveCount(1);
});

test('Alt Down and Alt Up move a bullet with everything under it past its neighbour', async ({ page, app }) => {
  const note = await open(page, app);
  await text(page).getByText('Format', { exact: true }).click();
  await settle(page);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await noteOf(app, note.id)).body).toBe('Intro line\n\n* Agenda\n  * Talks\n* Format\n  * One exercise\n  * Two exercises\n* Venue');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await noteOf(app, note.id)).body).toBe('Intro line\n\n* Agenda\n  * Talks\n* Venue\n* Format\n  * One exercise\n  * Two exercises');
  await page.keyboard.press('Alt+ArrowDown'); // at the end: nothing moves
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByRole('status')).toHaveText('Saved');
  expect((await noteOf(app, note.id)).body).toBe('Intro line\n\n* Agenda\n  * Talks\n* Format\n  * One exercise\n  * Two exercises\n* Venue');
});

test('Cmd . zooms into a bullet: its children are the page, with a path above that leads back', async ({ page, app }) => {
  const note = await open(page, app);
  await text(page).getByText('One exercise', { exact: true }).click();
  await settle(page);
  await page.keyboard.press('ControlOrMeta+.');
  const path = page.getByRole('navigation', { name: 'Zoom path' });
  await expect(path).toBeVisible();
  await expect(path.getByRole('button')).toHaveText(['Ideas for the autumn workshop', 'Format', 'One exercise']);
  await expect(text(page).getByText('Agenda')).toBeHidden();
  await expect(text(page).getByText('Intro line')).toBeHidden();
  await expect(text(page).getByText('One exercise')).toBeVisible();
  expect((await noteOf(app, note.id)).body).toBe(BODY); // a view, not an edit

  await path.getByRole('button', { name: 'Ideas for the autumn workshop' }).click();
  await expect(path).toBeHidden();
  await expect(text(page).getByText('Agenda')).toBeVisible();

  await text(page).getByText('Format', { exact: true }).click();
  await settle(page);
  await page.keyboard.press('ControlOrMeta+.');
  await expect(path.getByRole('button')).toHaveText(['Ideas for the autumn workshop', 'Format']);
  await expect(text(page).getByText('Two exercises')).toBeVisible();
  await expect(text(page).getByText('Talks')).toBeHidden();
  await expect((await noteOf(app, note.id)).body).toBe(BODY);
});

test('switched off, every note is its plain indented text again and the bullets are kept', async ({ page, app }) => {
  const note = await open(page, app);
  await page.goto(`${app.url}/settings`);
  const row = page.locator('[data-module="writing"]');
  await expect(row).toContainText('Writing and thinking');
  await row.getByRole('button', { name: 'Off' }).click();
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(text(page)).toContainText('Intro line');
  await expect(page.locator('.fold-toggle')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+.');
  await expect(page.getByRole('navigation', { name: 'Zoom path' })).toBeHidden();
  expect((await fetch(`${app.url}/api/notes/${note.id}/bullets`).then((r) => r.json())).module).toBe(false);
  expect((await noteOf(app, note.id)).body).toBe(BODY);
});
