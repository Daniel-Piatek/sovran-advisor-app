// The pen (advanced/writing/8): ink kept with pressure and time, handwriting read as words by the (stand-in) assistant, a page under the board.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures.js';

const post = (app, url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const boardOf = (app, id) => fetch(`${app.url}/api/boards/${id}`).then((r) => r.json());

async function board(app) {
  const note = await app.createNote({ title: 'Ideas for the autumn workshop', body: 'x' });
  const made = await post(app, '/api/boards', { note_id: note.id, title: 'Workshop flow' });
  await post(app, `/api/boards/${made.id}/items`, { kind: 'card', text: 'Pricing case', x: 300, y: 200 });
  return { note, board: made };
}
async function draw(page, region, from, to) {
  const frame = region.locator('.board-frame');
  const box = await frame.boundingBox();
  await page.mouse.move(box.x + from[0] * (box.width / 1200), box.y + from[1] * (box.width / 1200));
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + (from[0] + (to[0] - from[0]) * (i / 6)) * (box.width / 1200), box.y + (from[1] + (to[1] - from[1]) * (i / 6)) * (box.width / 1200));
  await page.mouse.up();
}

test('Pen on, draw a line: it is kept with the pressure and time of each point and is still there after a reload', async ({ page, app }) => {
  const { board: b } = await board(app);
  await page.goto(`${app.url}/boards/${b.id}`);
  const region = page.getByRole('region', { name: 'Board: Workshop flow' });
  await region.getByRole('button', { name: 'Pen', exact: true }).click();
  await expect(region.getByRole('button', { name: 'Pen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await draw(page, region, [100, 400], [500, 450]);
  await expect(region.locator('.ink-stroke')).toHaveCount(1);
  const [stroke] = (await boardOf(app, b.id)).strokes;
  expect(stroke.points.length).toBeGreaterThan(3);
  expect(stroke.points[0]).toHaveLength(4);
  expect(stroke.points.every((p) => p[2] === 0.5)).toBe(true); // a mouse presses at 0.5
  expect(stroke.points.at(-1)[3]).toBeGreaterThan(0); // time since the stroke began
  await page.reload();
  await expect(page.getByRole('region', { name: 'Board: Workshop flow' }).locator('.ink-stroke')).toHaveCount(1);
});

test('To text: your assistant reads the handwriting, the words become a text item and the ink fades below them; a correction to the words wins', async ({ page, app }) => {
  const { board: b } = await board(app);
  await page.goto(`${app.url}/boards/${b.id}`);
  const region = page.getByRole('region', { name: 'Board: Workshop flow' });
  await region.getByRole('button', { name: 'Pen', exact: true }).click();
  await draw(page, region, [620, 220], [760, 240]);
  await draw(page, region, [620, 280], [760, 300]);
  await expect(region.locator('.ink-stroke')).toHaveCount(2);
  await region.getByRole('button', { name: 'To text' }).click();
  await expect(region.getByRole('group', { name: 'Text: longer?' })).toBeVisible();
  await expect(region.locator('.ink-stroke.is-faded')).toHaveCount(2);
  await expect(region.getByRole('button', { name: 'To text' })).toHaveCount(0); // nothing left to read
  const saved = await boardOf(app, b.id);
  expect(saved.strokes.every((s) => s.faded && s.text_item_id)).toBe(true);
  expect(saved.items.find((i) => i.kind === 'text').text).toBe('longer?');
  // the picture went to the assistant's own folder, and the turn is in the Assistant
  const chats = await fetch(`${app.url}/api/conversations`).then((r) => r.json());
  expect(chats.length).toBe(1);
  const folder = path.join(app.dataDir, (await fetch(`${app.url}/api/conversations/${chats[0].id}`).then((r) => r.json())).folder, 'handwriting.png');
  expect(fs.readFileSync(folder).subarray(1, 4).toString()).toBe('PNG');

  await region.getByRole('button', { name: 'Pen', exact: true }).click(); // pen off: the words can be edited
  await region.getByRole('group', { name: 'Text: longer?' }).dblclick();
  await region.getByLabel('Its words').fill('longer day?');
  await region.getByLabel('Its words').press('Enter');
  await expect(region.getByRole('group', { name: 'Text: longer day?' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Board: Workshop flow' }).getByRole('group', { name: 'Text: longer day?' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Board: Workshop flow' }).locator('.ink-stroke.is-faded')).toHaveCount(2); // and so is the ink
});

test('Page: a picture lies under the board and you draw over it; No page takes it away', async ({ page, app }) => {
  const { board: b } = await board(app);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'page-')), 'notebook-page.png');
  fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  await page.goto(`${app.url}/boards/${b.id}`);
  const region = page.getByRole('region', { name: 'Board: Workshop flow' });
  await region.getByLabel('Choose a page').setInputFiles(file);
  await expect(region.getByRole('img', { name: 'Page: notebook-page.png' })).toBeAttached();
  expect((await boardOf(app, b.id)).background).toMatchObject({ name: 'notebook-page.png', type: 'image/png' });
  await region.getByRole('button', { name: 'No page' }).click();
  await expect(region.locator('.board-page')).toHaveCount(0);
  expect((await boardOf(app, b.id)).background).toBe(null);
});
