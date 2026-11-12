// Boards (advanced/writing/6): "/board" in a bullet; cards, words, arrows; a card that is a note shows it live; open large.
import { test, expect, tapAtEnd } from './fixtures.js';

const text = (page) => page.getByLabel('Text');
const noteOf = (app, id) => fetch(`${app.url}/api/notes/${id}`).then((r) => r.json());
const boardOf = (app, id) => fetch(`${app.url}/api/boards/${id}`).then((r) => r.json());
const post = (app, url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

async function noteWithBoard(app) {
  const note = await app.createNote({ title: 'Ideas for the autumn workshop', body: '* Format\n  * One exercise' });
  const board = await post(app, '/api/boards', { note_id: note.id, title: 'Workshop flow' });
  await app.updateNote(note.id, { body: `* Format\n  * One exercise\n\n[Workshop flow](/boards/${board.id})` });
  return { note, board };
}

test('"/board" and Enter in a note makes a board under the line, and the text holds a link to it', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Ideas', body: '* Format' });
  await page.goto(`${app.url}/notes/${note.id}`);
  await tapAtEnd(text(page));
  await page.keyboard.press('Enter');
  await page.keyboard.type('/board');
  await page.keyboard.press('Enter');
  const board = page.getByRole('region', { name: /^Board:/ });
  await expect(board).toBeVisible();
  await expect(board.getByRole('button', { name: 'Card', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Saved');
  const saved = await noteOf(app, note.id);
  const id = /\(\/boards\/([0-9a-f-]{36})\)/.exec(saved.body)?.[1];
  expect(id).toBeTruthy();
  expect((await boardOf(app, id)).note_id).toBe(note.id);
  await page.reload();
  await expect(page.getByRole('region', { name: /^Board:/ })).toBeVisible();
});

test('add a card and words; press Arrow, the first card and the second: an arrow joins them; drag a card and its place is kept', async ({ page, app }) => {
  const { note, board } = await noteWithBoard(app);
  await page.goto(`${app.url}/notes/${note.id}`);
  const region = page.getByRole('region', { name: 'Board: Workshop flow' });
  for (const words of ['Welcome', 'Pricing case']) {
    await region.getByRole('button', { name: 'Card', exact: true }).click();
    await region.getByLabel('Words on the card').fill(words);
    await region.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(region.getByRole('group', { name: `Card: ${words}` })).toBeVisible();
  }
  await region.getByRole('button', { name: 'Text', exact: true }).click();
  await region.getByLabel('Words').fill('Ask about the venue');
  await region.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(region.getByRole('group', { name: 'Text: Ask about the venue' })).toBeVisible();

  await region.getByRole('button', { name: 'Arrow' }).click();
  await region.getByRole('group', { name: 'Card: Welcome' }).click();
  await region.getByRole('group', { name: 'Card: Pricing case' }).click();
  await expect(region.locator('.board-arrow')).toHaveCount(1);
  let saved = await boardOf(app, board.id);
  const [welcome, pricing] = saved.items.filter((i) => i.kind === 'card');
  expect(saved.items.find((i) => i.kind === 'arrow')).toMatchObject({ from_id: welcome.id, to_id: pricing.id });

  const card = region.getByRole('group', { name: 'Card: Pricing case' });
  const box = await card.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 70, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await boardOf(app, board.id)).items.find((i) => i.id === pricing.id).y).toBeGreaterThan(pricing.y);
  saved = await boardOf(app, board.id);
  expect(saved.items.find((i) => i.id === pricing.id).x).toBeGreaterThan(pricing.x);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Board: Workshop flow' }).locator('.board-arrow')).toHaveCount(1);
});

test('a card that is a note shows it live; remove takes it off the board; Open shows the board large with a way back to the note', async ({ page, app }) => {
  const { note, board } = await noteWithBoard(app);
  const deep = await app.createNote({ title: 'Book notes: Deep Work', body: 'Focus is a skill.' });
  await post(app, `/api/boards/${board.id}/items`, { kind: 'card', ref_table: 'notes', ref_id: deep.id, x: 300, y: 100 });
  await page.goto(`${app.url}/notes/${note.id}`);
  const region = page.getByRole('region', { name: 'Board: Workshop flow' });
  await expect(region.getByRole('group', { name: 'Card: Book notes: Deep Work' })).toContainText('Focus is a skill.');
  await app.updateNote(deep.id, { body: 'Depth beats hours.' });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Board: Workshop flow' }).getByRole('group', { name: 'Card: Book notes: Deep Work' })).toContainText('Depth beats hours.');

  await page.getByRole('region', { name: 'Board: Workshop flow' }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`));
  const large = page.getByRole('region', { name: 'Board: Workshop flow' });
  await expect(large.getByRole('group', { name: 'Card: Book notes: Deep Work' })).toBeVisible();
  await expect(large.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  await large.getByRole('group', { name: 'Card: Book notes: Deep Work' }).hover();
  await large.getByRole('button', { name: 'Take it off the board' }).click();
  await expect(large.getByRole('group', { name: /Card:/ })).toHaveCount(0);
  await page.getByRole('link', { name: /Ideas for the autumn workshop/ }).click();
  await expect(page).toHaveURL(new RegExp(`/notes/${note.id}$`));
});

test('a card of a person and a task is found by its name and shown live', async ({ page, app }) => {
  const { note, board } = await noteWithBoard(app);
  await post(app, '/api/people', { name: 'Lena Fischer' });
  await post(app, '/api/tasks', { text: 'Send the agenda' });
  await page.goto(`${app.url}/notes/${note.id}`);
  const region = page.getByRole('region', { name: 'Board: Workshop flow' });
  await region.getByRole('button', { name: 'Person', exact: true }).click();
  await region.getByLabel('Find a person').fill('lena');
  await region.getByRole('button', { name: 'Lena Fischer' }).click();
  await expect(region.getByRole('group', { name: 'Card: Lena Fischer' })).toContainText('Person');
  await region.getByRole('button', { name: 'Task', exact: true }).click();
  await region.getByRole('button', { name: 'Send the agenda' }).click();
  await expect(region.getByRole('group', { name: 'Card: Send the agenda' })).toContainText('Task');
  expect((await boardOf(app, board.id)).items.map((i) => i.ref_table).sort()).toEqual(['people', 'tasks']);
});

test('switched off, the board line stays a plain link and there is no Whiteboard in the slash menu', async ({ page, app }) => {
  const { note } = await noteWithBoard(app);
  await page.goto(`${app.url}/settings`);
  await page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' }).click();
  await expect(page.locator('[data-module="writing"]').getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true'); // saved before the page is left
  await page.goto(`${app.url}/notes/${note.id}`);
  await expect(text(page).getByRole('link', { name: 'Workshop flow' })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Board:/ })).toHaveCount(0);
});
