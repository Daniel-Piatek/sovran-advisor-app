// The pen (advanced/writing/8) was taken off every board on the owner's wish (2026-11-16): old ink still shows and can be cleared; a page under the board.
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
test('no Pen and no To text on any board; ink drawn before still shows, and Clear drawing takes it away', async ({ page, app }) => {
  const { board: b } = await board(app);
  await post(app, `/api/boards/${b.id}/strokes`, { points: [[100, 400, 0.5, 0], [300, 420, 0.5, 40], [500, 450, 0.5, 80]] });
  await page.goto(`${app.url}/boards/${b.id}`);
  const region = page.getByRole('region', { name: 'Board: Workshop flow' });
  await expect(region.locator('.ink-stroke')).toHaveCount(1);
  await expect(region.getByRole('button', { name: 'Pen', exact: true })).toHaveCount(0);
  await expect(region.getByRole('button', { name: 'To text' })).toHaveCount(0);
  await region.getByRole('button', { name: 'Clear drawing' }).click();
  await expect(region.locator('.ink-stroke')).toHaveCount(0);
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
