// Boards of their own (the Boards tab of Notes, schema 75): an endless whiteboard to bring notes, journal entries and Inbox items onto,
// quick cards that become notes, groups whose cards move with them, a card opened beside the board, moving around and zooming.
import { test, expect } from './fixtures.js';

const boardOf = (app, id) => fetch(`${app.url}/api/boards/${id}`).then((r) => r.json());
const send = (app, method, url, body) => fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const isPhone = (page) => page.viewportSize().width < 900;

// Boards is off until switched on in the student app: each test switches it on first.
test.beforeEach(async ({ app }) => { await send(app, 'PATCH', '/api/modules', { id: 'boards', on: true }); });

async function things(app) {
  const note = await app.createNote({ title: 'Pricing the workshop', body: 'Three tiers: solo, small group, company' });
  await app.createNote({ title: 'Garden plans', body: 'Tomatoes' });
  const entry = await send(app, 'POST', '/api/entries', { day: '2026-11-14', body: 'Long walk by the sea\nThought about group pricing' });
  const capture = await send(app, 'POST', '/api/captures', { body: 'Idea: a price for groups of 5 or more' });
  return { note, entry, capture };
}

// The list of notes to add is open on a computer and folded on a phone.
async function openList(page) {
  const toggle = page.locator('.board-sources-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

test('the Boards tab: New board opens an endless board; a note, a journal entry and an Inbox item go on with +, live; the tile lists them', async ({ page, app }) => {
  await things(app);
  await page.goto(app.url);
  await page.getByRole('tab', { name: 'Boards' }).click();
  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByText('No boards yet.')).toBeVisible();
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
  await page.keyboard.type('Pricing ideas');
  const id = page.url().split('/').pop();
  await expect.poll(async () => (await boardOf(app, id)).title).toBe('Pricing ideas');
  expect((await boardOf(app, id)).endless).toBe(true);

  await openList(page);
  const list = page.getByRole('complementary', { name: 'Put on the board' });
  await list.getByLabel('Find something to put on the board').fill('pric');
  await expect(list.getByRole('listitem').filter({ hasText: 'Garden plans' })).toHaveCount(0);
  for (const name of ['Pricing the workshop', 'Long walk by the sea', 'Idea: a price for groups of 5 or more']) {
    await list.getByRole('button', { name: `Put “${name}” on the board` }).click();
    await expect(page.getByRole('group', { name: `Card: ${name}` })).toBeVisible();
  }
  await expect(list.getByText('On the board')).toHaveCount(3);
  const board = page.getByRole('region', { name: 'Board: Pricing ideas' });
  await expect(board.locator('.board-card.is-journal')).toContainText('Journal · Sat, 14 Nov 2026');
  await expect(board.locator('.board-card.is-inbox')).toContainText('Inbox');
  // The cards don't hide each other.
  const boxes = await board.locator('.board-card').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const [a, b] = [boxes[i], boxes[j]];
    expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], 'two cards overlap').toBe(true);
  }

  await page.getByRole('link', { name: 'Boards' }).click();
  const tile = page.locator('.board-tile').filter({ hasText: 'Pricing ideas' });
  await expect(tile).toContainText('3 cards');
  await expect(tile.getByRole('listitem')).toHaveText(['Pricing the workshop', 'Long walk by the sea', 'Idea: a price for groups of 5 or more']);
  await page.getByRole('tab', { name: 'All notes' }).click();
  await expect(page.getByRole('heading', { name: 'Pricing the workshop' })).toBeVisible();
});

test('drag a note from the list onto the board: it lands where it is let go', async ({ page, app }) => {
  test.skip(isPhone(page), 'dragging from the list is for a computer; a phone uses +');
  await things(app);
  const board = await send(app, 'POST', '/api/boards', { endless: true, title: 'Drag test' });
  await page.goto(`${app.url}/boards/${board.id}`);
  const frame = page.locator('.board-frame');
  await page.locator('.board-source').filter({ hasText: 'Garden plans' }).dragTo(frame, { targetPosition: { x: 300, y: 200 } });
  const card = page.getByRole('group', { name: 'Card: Garden plans' });
  await expect(card).toBeVisible();
  const [f, c] = [await frame.boundingBox(), await card.boundingBox()];
  expect(Math.abs(c.x + c.width / 2 - (f.x + 300))).toBeLessThan(60);
  expect((await boardOf(app, board.id)).items[0]).toMatchObject({ ref_table: 'notes', kind: 'card' });
});

test('a quick card becomes a real note; double-click a note card to change the note beside the board', async ({ page, app }) => {
  const { note } = await things(app);
  const board = await send(app, 'POST', '/api/boards', { endless: true, title: 'Workshop' });
  await send(app, 'POST', `/api/boards/${board.id}/items`, { kind: 'card', ref_table: 'notes', ref_id: note.id, x: 10000, y: 10000 });
  await page.goto(`${app.url}/boards/${board.id}`);
  const region = page.getByRole('region', { name: 'Board: Workshop' });
  await region.getByRole('button', { name: 'Card', exact: true }).click();
  await region.getByLabel('Words on the card').fill('Offer a group price');
  await region.getByRole('button', { name: 'Add', exact: true }).click();
  const quick = region.getByRole('group', { name: 'Card: Offer a group price' });
  await expect(quick).toBeVisible();
  await page.evaluate(() => document.querySelector('.board-frame').scrollIntoView({ block: 'start' }));
  await quick.hover();
  await quick.getByRole('button', { name: 'Make it a note' }).click();
  await expect(region.locator('.board-card.is-note')).toHaveCount(2);
  const notes = await fetch(`${app.url}/api/notes`).then((r) => r.json());
  expect(notes.map((n) => n.title)).toContain('Offer a group price');

  await region.getByRole('group', { name: 'Card: Pricing the workshop' }).locator('.board-card-title').dblclick();
  const peek = page.getByRole('complementary', { name: 'Open card' });
  await expect(peek).toBeVisible();
  await expect(peek.getByLabel('Title')).toHaveValue('Pricing the workshop');
  const text = peek.getByLabel('Text');
  await text.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Four tiers now');
  await expect(peek.getByText('Saved')).toBeVisible();
  await peek.getByRole('button', { name: 'Close' }).click();
  await expect(peek).toBeHidden();
  await expect(region.getByRole('group', { name: 'Card: Pricing the workshop' })).toContainText('Four tiers now');
});

test('a group: its cards move with it; a colour can be chosen; zoom and Show all; a board is deleted with Undo', async ({ page, app }) => {
  const board = await send(app, 'POST', '/api/boards', { endless: true, title: 'Groups' });
  const group = await send(app, 'POST', `/api/boards/${board.id}/items`, { kind: 'group', text: 'Money', color: 'goal', x: 10000, y: 10000, w: 640, h: 420 });
  const inside = await send(app, 'POST', `/api/boards/${board.id}/items`, { kind: 'card', text: 'Inside', x: 10100, y: 10120 });
  const outside = await send(app, 'POST', `/api/boards/${board.id}/items`, { kind: 'card', text: 'Outside', x: 10900, y: 10120 });
  await page.goto(`${app.url}/boards/${board.id}`);
  const region = page.getByRole('region', { name: 'Board: Groups' });
  await expect(region.getByRole('group', { name: 'Group: Money' })).toBeVisible();

  const head = region.locator('.board-group-head');
  const box = await head.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await boardOf(app, board.id)).items.find((i) => i.id === group.id).y).toBeGreaterThan(10000);
  const after = await boardOf(app, board.id);
  const moved = after.items.find((i) => i.id === group.id).y - 10000;
  expect(after.items.find((i) => i.id === inside.id).y).toBe(10120 + moved);
  expect(after.items.find((i) => i.id === outside.id).y).toBe(10120);

  await head.hover();
  await region.getByRole('button', { name: 'Green colour' }).click();
  await expect.poll(async () => (await boardOf(app, board.id)).items.find((i) => i.id === group.id).color).toBe('life');
  await expect(region.locator('.board-group')).toHaveClass(/is-life/);

  const zoom = region.locator('.board-zoom-value');
  const before = await zoom.textContent();
  await region.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoom).not.toHaveText(before);
  await region.getByRole('button', { name: 'Show all' }).click();
  await expect(region.getByRole('group', { name: 'Card: Outside' })).toBeInViewport();

  await page.goto(`${app.url}/boards`);
  await page.locator('.board-tile').filter({ hasText: 'Groups' }).hover();
  await page.getByRole('button', { name: 'Delete Groups' }).click();
  await expect(page.locator('.board-tile')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.board-tile')).toHaveCount(1);
});

test('drag the empty board to move around: where you were is kept for next time', async ({ page, app }) => {
  const board = await send(app, 'POST', '/api/boards', { endless: true, title: 'Move' });
  await send(app, 'POST', `/api/boards/${board.id}/items`, { kind: 'card', text: 'Anchor', x: 10000, y: 10000 });
  await page.goto(`${app.url}/boards/${board.id}`);
  const card = page.getByRole('group', { name: 'Card: Anchor' });
  const start = await card.boundingBox();
  const frame = await page.locator('.board-frame').boundingBox();
  await page.mouse.move(frame.x + 20, frame.y + 60);
  await page.mouse.down();
  await page.mouse.move(frame.x + 80, frame.y + 20, { steps: 5 });
  await page.mouse.up();
  const end = await card.boundingBox();
  expect(Math.round(end.x - start.x)).toBe(60);
  expect(Math.round(end.y - start.y)).toBe(-40);
  await page.reload();
  const again = await page.getByRole('group', { name: 'Card: Anchor' }).boundingBox();
  expect(Math.abs(again.x - end.x)).toBeLessThan(2);
});

test('Boards switched off (Settings › Modules): no Boards tab and no new board of its own; boards inside notes are untouched', async ({ page, app }) => {
  const note = await app.createNote({ title: 'Workshop', body: '' });
  await send(app, 'PATCH', '/api/modules', { id: 'boards', on: false });
  await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'Workshop' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Boards' })).toHaveCount(0);
  const refused = await fetch(`${app.url}/api/boards`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endless: true }) });
  expect(refused.status).toBe(409);
  const inNote = await send(app, 'POST', '/api/boards', { note_id: note.id, title: 'Still works' });
  expect(inNote.endless).toBe(false);
});

test('Hide notes gives the board the width; Full screen fills the screen with the board, and Exit full screen (or Esc) goes back', async ({ page, app }) => {
  test.skip(isPhone(page), 'on a phone the list starts hidden and the board already fills the width');
  const board = await send(app, 'POST', '/api/boards', { endless: true, title: 'Room' });
  await page.goto(`${app.url}/boards/${board.id}`);
  const frame = page.locator('.board-frame');
  const list = page.getByRole('complementary', { name: 'Put on the board' });
  await expect(list).toBeVisible();
  const narrow = (await frame.boundingBox()).width;
  await page.getByRole('button', { name: 'Hide notes' }).click();
  await expect(list).toBeHidden();
  expect((await frame.boundingBox()).width).toBeGreaterThan(narrow + 200);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show notes' })).toBeVisible();
  await expect(list).toBeHidden();

  await page.getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('.board-layout')).toHaveClass(/is-full/);
  const full = await frame.boundingBox();
  const screenSize = page.viewportSize();
  expect(full.width).toBeGreaterThan(screenSize.width - 60);
  expect(full.height).toBeGreaterThan(screenSize.height - 120);
  await page.getByRole('button', { name: 'Show notes' }).click();
  await expect(list).toBeVisible();
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.locator('.board-layout')).not.toHaveClass(/is-full/);
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-layout')).not.toHaveClass(/is-full/);
});

test('Task opens a window of every open task, grouped by when; tick several and they go on the board; one there already says so', async ({ page, app }) => {
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await send(app, 'POST', '/api/tasks', { text: 'Call the printer', due: day(0), estimate: 30, flag: 'must' });
  await send(app, 'POST', '/api/tasks', { text: 'Write the brochure', due: day(3) });
  await send(app, 'POST', '/api/tasks', { text: 'Book the venue' });
  const board = await send(app, 'POST', '/api/boards', { endless: true, title: 'Workshop' });
  await page.goto(`${app.url}/boards/${board.id}`);
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Put tasks on the board' });
  await expect(picker.getByRole('heading', { name: /Today/ })).toBeVisible();
  await expect(picker.getByRole('heading', { name: /Upcoming/ })).toBeVisible();
  await expect(picker.getByRole('heading', { name: /No date/ })).toBeVisible();
  await expect(picker.locator('.plan-dialog-row').filter({ hasText: 'Call the printer' })).toContainText('30 min · Must');
  await picker.getByLabel('Find a task').fill('brochure');
  await expect(picker.locator('.plan-dialog-row')).toHaveCount(1);
  await picker.getByLabel('Write the brochure').check();
  await picker.getByLabel('Find a task').fill('');
  await picker.getByLabel('Book the venue').check();
  await picker.getByRole('button', { name: 'Put 2 on the board' }).click();
  await expect(page.getByRole('group', { name: 'Card: Write the brochure' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Card: Book the venue' })).toBeVisible();
  expect((await boardOf(app, board.id)).items.filter((i) => i.ref_table === 'tasks')).toHaveLength(2);

  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(picker.getByLabel('Book the venue')).toBeDisabled();
  await expect(picker.locator('.plan-dialog-row').filter({ hasText: 'Book the venue' })).toContainText('On the board');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
});

test('Clear drawing takes away all the ink; Undo brings it back', async ({ page, app }) => {
  const board = await send(app, 'POST', '/api/boards', { endless: true, title: 'Sketch' });
  await send(app, 'POST', `/api/boards/${board.id}/strokes`, { points: [[100, 100], [200, 150]] });
  await send(app, 'POST', `/api/boards/${board.id}/strokes`, { points: [[300, 100], [320, 250]] });
  await page.goto(`${app.url}/boards/${board.id}`);
  await page.getByRole('button', { name: 'Clear drawing' }).click();
  await expect.poll(async () => (await boardOf(app, board.id)).strokes.length).toBe(0);
  await expect(page.getByRole('button', { name: 'Clear drawing' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await boardOf(app, board.id)).strokes.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Clear drawing' })).toBeVisible();
});
