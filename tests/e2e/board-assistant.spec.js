// Your assistant on a board (advanced/writing/7). The assistant is tests/fake-claude.js.
import { test, expect } from './fixtures.js';

const post = (app, url, body) => fetch(app.url + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const bubbles = (page, role) => page.locator(`.chat-bubble[data-role="${role}"]`);

async function workshopBoard(app) {
  const note = await app.createNote({ title: 'Ideas for the autumn workshop', body: 'x' });
  const board = await post(app, '/api/boards', { note_id: note.id, title: 'Workshop flow' });
  const welcome = await post(app, `/api/boards/${board.id}/items`, { kind: 'card', text: 'Welcome', x: 40, y: 60 });
  const pricing = await post(app, `/api/boards/${board.id}/items`, { kind: 'card', text: 'Pricing case', x: 400, y: 60 });
  const qa = await post(app, `/api/boards/${board.id}/items`, { kind: 'card', text: 'Q&A', x: 800, y: 60 });
  await post(app, `/api/boards/${board.id}/items`, { kind: 'arrow', from_id: welcome.id, to_id: pricing.id });
  await post(app, `/api/boards/${board.id}/items`, { kind: 'arrow', from_id: pricing.id, to_id: qa.id });
  return { note, board, pricing, qa };
}
async function ask(page, app, words) {
  await page.goto(`${app.url}/assistant`);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.fill(words);
  await input.press('Enter');
  await expect(bubbles(page, 'assistant').last()).toHaveAttribute('data-state', 'done');
}

test('"What is missing in the Workshop flow board?": the answer names the cards and the arrows between them', async ({ page, app }) => {
  await workshopBoard(app);
  await ask(page, app, 'What is missing in the Workshop flow board?');
  const answer = bubbles(page, 'assistant').last();
  await expect(answer).toContainText('Welcome');
  await expect(answer).toContainText('Pricing case');
  await expect(answer).toContainText('Pricing case → Q&A');
});

test('"Add a break after the Pricing case": an approval card says what changes; Approve draws it marked as the assistant’s; Undo puts the board back', async ({ page, app }) => {
  const { board } = await workshopBoard(app);
  await ask(page, app, 'Add a break after the Pricing case');
  const card = page.locator('.action-card[data-kind="board_draw"]');
  await expect(card).toHaveAttribute('data-state', 'proposed');
  await expect(card).toContainText('Draw on the board “Workshop flow”: 1 new and 2 arrow(s)');
  await expect(card.getByRole('list', { name: 'What it would draw' })).toContainText('Card: Break');
  expect((await fetch(`${app.url}/api/boards/${board.id}`).then((r) => r.json())).items.length).toBe(5); // nothing yet

  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(card).toHaveAttribute('data-state', 'applied');
  await card.getByRole('link', { name: 'Open the board' }).click();
  await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`));
  const breakCard = page.getByRole('group', { name: 'Card: Break' });
  await expect(breakCard).toContainText('Your assistant');
  await expect(breakCard).toHaveClass(/is-assistant/);
  await expect(page.locator('.board-arrow.is-assistant')).toHaveCount(2); // Pricing case → Break → Q&A, dashed

  await page.goBack();
  await card.getByRole('button', { name: 'Undo' }).click();
  await expect(card).toHaveAttribute('data-state', 'undone');
  const after = await fetch(`${app.url}/api/boards/${board.id}`).then((r) => r.json());
  expect(after.items.map((i) => i.kind)).toEqual(['card', 'card', 'card', 'arrow', 'arrow']);
});

test('Not now draws nothing', async ({ page, app }) => {
  const { board } = await workshopBoard(app);
  await ask(page, app, 'Add a break after the Pricing case');
  await page.locator('.action-card[data-kind="board_draw"]').getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('.action-card[data-kind="board_draw"]')).toHaveAttribute('data-state', 'dismissed');
  expect((await fetch(`${app.url}/api/boards/${board.id}`).then((r) => r.json())).items.length).toBe(5);
});
